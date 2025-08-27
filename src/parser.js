const { CharStream, Lexer, TokenStream, Parser } = require("melody-parser");
const { extension: coreExtension } = require("melody-extension-core");
const enhancedMacroExtension = require("./extensions/enhanced-macro-extension");
const {
    getAdditionalMelodyExtensions,
    getPluginPathsFromOptions,
} = require("./util");

const ORIGINAL_SOURCE = Symbol("ORIGINAL_SOURCE");
const VUE_ALPINE_REPLACEMENTS = Symbol("VUE_ALPINE_REPLACEMENTS");

// Helper function to normalize JavaScript whitespace while preserving string literals
const normalizeJavaScriptWhitespace = (expression) => {
    let result = "";
    let inString = false;
    let stringChar = null;
    let escaped = false;

    for (let i = 0; i < expression.length; i++) {
        const char = expression[i];
        const nextChar = expression[i + 1];

        if (escaped) {
            result += char;
            escaped = false;
            continue;
        }

        if (char === "\\") {
            result += char;
            escaped = true;
            continue;
        }

        if (!inString && (char === '"' || char === "'")) {
            inString = true;
            stringChar = char;
            result += char;
            continue;
        }

        if (inString && char === stringChar) {
            inString = false;
            stringChar = null;
            result += char;
            continue;
        }

        if (inString) {
            // Inside a string - preserve all characters including whitespace
            result += char;
        } else {
            // Outside strings - normalize whitespace
            if (/\s/.test(char)) {
                // If current char is whitespace, check if we need to add a space
                if (
                    result &&
                    !result.endsWith(" ") &&
                    nextChar &&
                    !/\s/.test(nextChar)
                ) {
                    result += " ";
                }
                // Skip consecutive whitespace
            } else {
                result += char;
            }
        }
    }

    return result.trim();
};

// Regex patterns for Vue/Alpine.js attributes that cause parsing issues
const VUE_ALPINE_PATTERNS = [
    // Vue.js shorthand directives (e.g., @click="handler", @submit.prevent="handler")
    /@[a-zA-Z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)*(?:=["'][^]*?["']|\s|>)/g,
    // Vue.js v-on with modifiers (e.g., v-on:click.prevent="handler")
    /v-on:[a-zA-Z][a-zA-Z0-9-]*\.[a-zA-Z][a-zA-Z0-9.-]*(?:=["'][^]*?["']|\s|>)/g,
    // Alpine.js x-on with modifiers (e.g., x-on:item-selected.window="handler")
    /x-on:[a-zA-Z][a-zA-Z0-9-]*\.[a-zA-Z][a-zA-Z0-9.-]*(?:=["'][^]*?["']|\s|>)/g,
    // Other Alpine.js attributes with dots (e.g., x-data.foo="value")
    /x-[a-zA-Z][a-zA-Z0-9-]*\.[a-zA-Z][a-zA-Z0-9.-]*(?:=["'][^]*?["']|\s|>)/g,
];

const preprocessUnicodeCharacters = (text) => {
    // Temporarily protect HTML entities from being decoded by melody-parser
    // This is needed because melody-parser decodes entities even with decodeEntities: false
    const entityReplacements = new Map();
    let entityCounter = 0;

    let processedText = text;

    // Protect numeric HTML entities (e.g., &#8206;, &#160;)
    processedText = processedText.replace(/&#\d+;/g, (match) => {
        const placeholder = `__HTML_ENTITY_${entityCounter++}__`;
        entityReplacements.set(placeholder, match);
        return placeholder;
    });

    // Protect named HTML entities (e.g., &nbsp;, &amp;)
    processedText = processedText.replace(
        /&[a-zA-Z][a-zA-Z0-9]*;/g,
        (match) => {
            const placeholder = `__HTML_ENTITY_${entityCounter++}__`;
            entityReplacements.set(placeholder, match);
            return placeholder;
        },
    );

    return { processedText, entityReplacements };
};

const parseComplexAttributeValue = (attrName, attrValue) => {
    let depth = 0;
    let value = "";
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let position = 0;

    while (position < attrValue.length) {
        const char = attrValue[position];

        // Track quote state
        if (char === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
        }
        if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
        }

        // Track brace depth only outside quotes
        if (!inSingleQuote && !inDoubleQuote) {
            if (char === "{") {
                depth++;
            }
            if (char === "}") {
                depth--;
            }
        }

        value += char;
        position++;
    }

    return { type: "ComplexAttributeValue", value: value.trim() };
};

const parseStyleAttribute = (attrValue) => {
    let value = "";
    let inProperty = true;
    let position = 0;

    while (position < attrValue.length) {
        const char = attrValue[position];

        if (char === ":") {
            inProperty = false;
        }
        if (char === ";") {
            inProperty = true;
            // Don't treat semicolon as token separator in CSS context
        }

        value += char;
        position++;
    }

    return { type: "StyleAttribute", value: value.trim() };
};

const isAlpineAttribute = (attrName) => {
    const alpineAttributes = [
        "x-data",
        "x-show",
        "x-if",
        "x-for",
        "x-on",
        "x-bind",
        "x-model",
        "x-text",
        "x-html",
        "x-transition",
        "x-cloak",
    ];

    return alpineAttributes.some(
        (prefix) => attrName.startsWith(prefix) || attrName.startsWith("@"),
    );
};

const parseDataAttribute = (attrName, attrValue) => {
    if (attrValue.includes("{{") && attrValue.includes("}}")) {
        // Parse as mixed content (static + Twig expression)
        return parseMixedAttributeContent(attrValue);
    }
    return { type: "StaticAttribute", name: attrName, value: attrValue };
};

const parseMixedAttributeContent = (attrValue) => {
    const parts = [];
    let currentPart = "";
    let inTwigExpression = false;
    let position = 0;

    while (position < attrValue.length) {
        if (
            position < attrValue.length - 1 &&
            attrValue.substr(position, 2) === "{{"
        ) {
            // Start of Twig expression
            if (currentPart) {
                parts.push({ type: "StaticText", value: currentPart });
                currentPart = "";
            }
            inTwigExpression = true;
            position += 2;
        } else if (
            position < attrValue.length - 1 &&
            attrValue.substr(position, 2) === "}}" &&
            inTwigExpression
        ) {
            // End of Twig expression
            if (currentPart) {
                parts.push({
                    type: "TwigExpression",
                    expression: currentPart.trim(),
                });
                currentPart = "";
            }
            inTwigExpression = false;
            position += 2;
        } else {
            currentPart += attrValue[position];
            position++;
        }
    }

    if (currentPart) {
        if (inTwigExpression) {
            parts.push({
                type: "TwigExpression",
                expression: currentPart.trim(),
            });
        } else {
            parts.push({ type: "StaticText", value: currentPart });
        }
    }

    return { type: "MixedAttribute", parts };
};

// Comprehensive Alpine.js attribute preprocessing
const preprocessAlpineJSAttributes = (
    text,
    replacements,
    replacementCounter,
) => {
    let processedText = text;

    // Alpine.js attributes that commonly contain JavaScript objects/expressions
    const alpineAttributes = [
        "x-data",
        "x-show",
        "x-if",
        "x-for",
        "x-model",
        "x-text",
        "x-html",
        "x-bind",
        "x-on",
        "x-transition",
        "x-effect",
        "x-init",
    ];

    // Build comprehensive regex pattern for all Alpine.js attributes
    // Start simple - just match Alpine attributes with any content
    const alpineAttributePatterns = [
        // x-bind:attribute="anything"
        /(x-bind:[a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g,
        // @event="anything" (Alpine.js/Vue.js event shorthand)
        /(@[a-zA-Z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9.-]*)*)="([^"]*)"/g,
        // :attribute="anything" (Vue.js property binding shorthand)
        /(:(?!xmlns)[a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g,
        // Standard Alpine.js attributes - match any content
        ...alpineAttributes.map(
            (attr) =>
                new RegExp(
                    `(${attr.replace("-", "\\-")}(?:\\.[a-zA-Z][a-zA-Z0-9.-]*)?)="([^"]*)"`,
                    "g",
                ),
        ),
    ];

    alpineAttributePatterns.forEach((pattern) => {
        processedText = processedText.replace(
            pattern,
            (match, attrName, attrValue) => {
                // Check if this is already a mixed Twig/Alpine attribute (has {{ }})
                if (attrValue.includes("{{") && attrValue.includes("}}")) {
                    // Handle as mixed attribute
                    const twigExpressions = [];
                    const processedValue = attrValue.replace(
                        /\{\{([^}]+)\}\}/g,
                        (twigMatch, expr) => {
                            const twigPlaceholder = `__TWIG_EXPR_${twigExpressions.length}__`;
                            twigExpressions.push(expr.trim());
                            return twigPlaceholder;
                        },
                    );

                    const mixedAttrId = `mixed-attr-${replacementCounter.value++}`;
                    const attrNameId = `data-alpine-mixed-${replacementCounter.value++}`;

                    replacements.set(mixedAttrId, {
                        type: "MixedAttribute",
                        attrName,
                        processedValue,
                        twigExpressions,
                        originalValue: attrValue,
                    });
                    replacements.set(attrNameId, attrName);

                    return `${attrNameId}="${mixedAttrId}"`;
                }
                // Handle as pure Alpine.js attribute
                const alpineAttrId = `alpine-attr-${replacementCounter.value++}`;
                const attrNameId = `data-alpine-pure-${replacementCounter.value++}`;

                replacements.set(alpineAttrId, {
                    type: "AlpineAttribute",
                    attrName,
                    originalValue: attrValue,
                });
                replacements.set(attrNameId, attrName);

                return `${attrNameId}="${alpineAttrId}"`;
            },
        );
    });

    return { processedText, replacementCounter };
};

const preprocessVueAlpineAttributes = (text) => {
    const replacements = new Map();
    const replacementCounter = { value: 0 };
    let processedText = text;

    // First pass: Handle comprehensive Alpine.js attributes
    const alpineResult = preprocessAlpineJSAttributes(
        processedText,
        replacements,
        replacementCounter,
    );
    processedText = alpineResult.processedText;

    // Second pass: Handle v-pre elements - preserve their content completely
    // This must be done before any other processing to ensure v-pre content is untouched
    // Use a smart regex that matches any valid HTML element with v-pre directive

    // Match any HTML element with v-pre directive
    // Pattern explanation:
    // - ([a-zA-Z][a-zA-Z0-9-]*) captures the element name (must start with letter, can contain letters, numbers, hyphens)
    // - ([^>]*?\bv-pre\b[^>]*) captures the full opening tag attributes including v-pre
    // - ([\s\S]*?) captures the element content (non-greedy, matches any character including newlines)
    // - <\/\1\s*> matches the closing tag using backreference to the opening tag name
    const vPreRegex =
        /<([a-zA-Z][a-zA-Z0-9-]*)([^>]*?\bv-pre\b[^>]*)>([\s\S]*?)<\/\1\s*>/gi;

    processedText = processedText.replace(
        vPreRegex,
        (match, elementName, attributes, content) => {
            // Store the entire v-pre content as-is
            const vPreContentId = `v-pre-content-${replacementCounter.value++}`;
            replacements.set(vPreContentId, content);

            // Return the element with a placeholder for its content
            // Use plain text that won't be parsed as template syntax
            return `<${elementName}${attributes}>${vPreContentId}</${elementName}>`;
        },
    );

    // Third pass: Protect HTML entities from being decoded by melody-parser
    const { processedText: entityProtectedText, entityReplacements } =
        preprocessUnicodeCharacters(processedText);
    processedText = entityProtectedText;

    // Merge entity replacements into main replacements map
    for (const [placeholder, entity] of entityReplacements) {
        replacements.set(placeholder, entity);
    }

    // Fourth pass: Format and protect script and style tag content
    // This formats JavaScript/CSS code while preserving Twig expressions
    const {
        formatJavaScriptWithTwig,
        formatCSSWithTwig,
    } = require("./util/scriptFormatting");

    processedText = processedText.replace(
        /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
        (match, tagName, attributes, content) => {
            const placeholderId = `${tagName.toLowerCase()}-content-${replacementCounter.value++}`;

            // Skip formatting if content is empty or only whitespace
            if (!content.trim()) {
                replacements.set(placeholderId, content);
                return `<${tagName}${attributes}>${placeholderId}</${tagName}>`;
            }

            let formattedContent = content;

            // Format based on tag type
            if (tagName.toLowerCase() === "script") {
                // Check if this is actually JavaScript (not JSON or other content)
                const typeAttr = attributes.match(
                    /type\s*=\s*["']([^"']+)["']/i,
                );
                const scriptType = typeAttr
                    ? typeAttr[1].toLowerCase()
                    : "text/javascript";

                if (
                    scriptType === "text/javascript" ||
                    scriptType === "application/javascript" ||
                    scriptType === "module" ||
                    !typeAttr // Default to JavaScript if no type specified
                ) {
                    try {
                        formattedContent = formatJavaScriptWithTwig(
                            content.trim(),
                        );
                    } catch (error) {
                        console.warn(
                            "Failed to format JavaScript in script tag:",
                            error.message,
                        );
                        formattedContent = content; // Keep original on error
                    }
                }
            } else if (tagName.toLowerCase() === "style") {
                try {
                    formattedContent = formatCSSWithTwig(content.trim());
                } catch (error) {
                    console.warn(
                        "Failed to format CSS in style tag:",
                        error.message,
                    );
                    formattedContent = content; // Keep original on error
                }
            }

            replacements.set(placeholderId, formattedContent);
            return `<${tagName}${attributes}>${placeholderId}</${tagName}>`;
        },
    );
    // Fifth pass: Handle inline Twig conditionals in HTML element tags
    // This handles cases like: <div {% if condition %} attribute="value" {% endif %}>
    // Need to process all Twig blocks in a single element tag
    processedText = processedText.replace(
        /<([^<>]*?)>/g,
        (match, elementContent, offset, string) => {
            // Check if this element is inside a Twig comment
            const beforeElement = string.substring(0, offset);
            const lastCommentStart = beforeElement.lastIndexOf("{#");
            const lastCommentEnd = beforeElement.lastIndexOf("#}");

            // If we're inside a Twig comment, don't process this element
            if (lastCommentStart > lastCommentEnd) {
                return match; // Return unchanged
            }

            // Skip processing if this doesn't contain Twig blocks or comments
            if (
                !elementContent.includes("{%") &&
                !elementContent.includes("{#")
            ) {
                return match;
            }

            let processedContent = elementContent;

            // Handle Twig comment blocks first to avoid processing Twig syntax inside comments
            // Find all complete {# ... #} blocks that are outside of quotes
            const commentBlocks = [];
            let pos = 0;
            let inQuotes = false;
            let quoteChar = null;

            while (pos < processedContent.length) {
                const char = processedContent[pos];

                if ((char === '"' || char === "'") && !inQuotes) {
                    inQuotes = true;
                    quoteChar = char;
                } else if (char === quoteChar && inQuotes) {
                    inQuotes = false;
                    quoteChar = null;
                }

                // Look for {# at current position when not in quotes
                if (
                    !inQuotes &&
                    processedContent.substr(pos).startsWith("{#")
                ) {
                    // Find the matching #}
                    let searchPos = pos + 2; // Start after '{#'
                    let blockEnd = -1;

                    while (searchPos < processedContent.length - 1) {
                        if (processedContent.substr(searchPos, 2) === "#}") {
                            blockEnd = searchPos + 2; // End after '#}'
                            break;
                        }
                        searchPos++;
                    }

                    if (blockEnd > -1) {
                        const block = processedContent.substring(pos, blockEnd);
                        commentBlocks.push({
                            start: pos,
                            end: blockEnd,
                            content: block,
                        });
                        pos = blockEnd;
                        continue;
                    }
                }

                pos++;
            }

            // Replace comment blocks from right to left to maintain correct positions
            commentBlocks.reverse().forEach((block) => {
                const placeholderId = `data-twig-comment-${replacementCounter.value++}`;
                replacements.set(placeholderId, block.content);
                processedContent =
                    processedContent.substring(0, block.start) +
                    `${placeholderId}="1"` +
                    processedContent.substring(block.end);
            });

            // Handle complex nested Twig conditional blocks more carefully
            // Now process {% if %}...{% endif %} blocks that are NOT inside comments
            // First, find all complete {% if %}...{% endif %} blocks that are outside of quotes
            const ifBlocks = [];
            pos = 0;
            inQuotes = false;
            quoteChar = null;

            while (pos < processedContent.length) {
                const char = processedContent[pos];

                if ((char === '"' || char === "'") && !inQuotes) {
                    inQuotes = true;
                    quoteChar = char;
                } else if (char === quoteChar && inQuotes) {
                    inQuotes = false;
                    quoteChar = null;
                }

                // Look for {% if at current position when not in quotes
                if (
                    !inQuotes &&
                    processedContent.substr(pos).startsWith("{% if ")
                ) {
                    // Find the matching {% endif %}
                    let ifCount = 1;
                    let searchPos = pos + 6; // Start after '{% if '
                    let blockEnd = -1;

                    while (searchPos < processedContent.length && ifCount > 0) {
                        if (
                            processedContent
                                .substr(searchPos)
                                .startsWith("{% if ")
                        ) {
                            ifCount++;
                            searchPos += 6;
                        } else if (
                            processedContent
                                .substr(searchPos)
                                .startsWith("{% endif %}")
                        ) {
                            ifCount--;
                            if (ifCount === 0) {
                                blockEnd = searchPos + 11; // End after '{% endif %}'
                            }
                            searchPos += 11;
                        } else {
                            searchPos++;
                        }
                    }

                    if (blockEnd > -1) {
                        const block = processedContent.substring(pos, blockEnd);
                        ifBlocks.push({
                            start: pos,
                            end: blockEnd,
                            content: block,
                        });
                        pos = blockEnd;
                        continue;
                    }
                }

                pos++;
            }

            // Replace if blocks from right to left to maintain correct positions
            ifBlocks.reverse().forEach((block) => {
                const placeholderId = `data-twig-conditional-${replacementCounter.value++}`;
                replacements.set(placeholderId, block.content);
                processedContent =
                    processedContent.substring(0, block.start) +
                    `${placeholderId}="1"` +
                    processedContent.substring(block.end);
            });

            // Then handle HTML attribute values that contain Twig syntax or complex Alpine.js expressions
            // This regex is more careful to only match actual HTML attributes by ensuring
            // we're inside an HTML element context (surrounded by < and >)
            processedContent = processedContent.replace(
                /(\w+(?::[^=\s]*|@[^=\s]*)?|style|x-[^=\s]*|v-[^=\s]*)="([^"]*(?:\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}|[;:|&=><(){}[\]]+)[^"]*)"/g,
                (match, attrName, attrValue) => {
                    let parsedValue = attrValue;

                    // Use specialized parsing for different attribute types
                    if (attrName === "style") {
                        const styleResult = parseStyleAttribute(attrValue);
                        parsedValue = styleResult.value;
                    } else if (
                        isAlpineAttribute(attrName) ||
                        attrName.startsWith("@") ||
                        attrName.startsWith(":")
                    ) {
                        const complexResult = parseComplexAttributeValue(
                            attrName,
                            attrValue,
                        );
                        parsedValue = complexResult.value;
                    } else if (
                        attrName.startsWith("data-") &&
                        (attrValue.includes("{{") || attrValue.includes("{%"))
                    ) {
                        const dataResult = parseDataAttribute(
                            attrName,
                            attrValue,
                        );
                        if (dataResult.type === "MixedAttribute") {
                            parsedValue = attrValue; // Keep original for mixed content
                        } else {
                            parsedValue = dataResult.value;
                        }
                    }

                    const placeholderId = `twig-attr-value-${replacementCounter.value++}`;
                    replacements.set(placeholderId, parsedValue);
                    return `${attrName}="${placeholderId}"`;
                },
            );

            return `<${processedContent}>`;
        },
    );

    // Sixth pass: Handle Vue/Alpine.js attributes that cause parsing issues
    // Order matters - more specific patterns first!
    const patterns = [
        // Vue.js v-on with or without modifiers (e.g., v-on:click, v-on:click.prevent) - MUST BE FIRST
        /\b(v-on:[a-zA-Z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9.-]*)*)(?=\s*=|\s|>)/g,
        // Vue.js v-bind with attribute (e.g., v-bind:class, v-bind:data-text) - MUST BE SECOND
        /\b(v-bind:[a-zA-Z][a-zA-Z0-9-]*)(?=\s*=|\s|>)/g,
        // Vue.js standard directives with optional modifiers (v-model.lazy, v-show.transition, etc.)
        // Note: v-pre is handled separately and excluded from this pattern
        /\b(v-(?:if|else-if|else|for|show|model|text|html|cloak|once|memo|slot|key|ref|is|bind)(?:\.[a-zA-Z][a-zA-Z0-9.-]*)?)(?=\s*=|\s|>)/g,
        // Alpine.js x-on with modifiers containing dots
        /\b(x-on:[a-zA-Z][a-zA-Z0-9-]*\.[a-zA-Z][a-zA-Z0-9.-]*)(?=\s*=|\s|>)/g,
        // Other Alpine.js attributes with dots
        /\b(x-[a-zA-Z][a-zA-Z0-9-]*\.[a-zA-Z][a-zA-Z0-9.-]*)(?=\s*=|\s|>)/g,
        // Vue.js shorthand directives with @ symbol
        /@([a-zA-Z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)*)(?=\s*=|\s|>)/g,
        // Vue.js v-bind shorthand with : symbol (e.g., :class, :style) - MUST BE LAST
        // Only match when preceded by whitespace or start of tag to avoid matching colons in attribute values
        // This prevents matching Tailwind pseudo-classes like hover:, focus:, etc.
        /(?<=\s|<):([a-zA-Z][a-zA-Z0-9-]*)(?=\s*=|\s|>)/g,
    ];

    patterns.forEach((pattern, index) => {
        processedText = processedText.replace(
            pattern,
            (match, captured, offset) => {
                // Check if this match is inside an HTML comment or Twig comment
                const beforeMatch = processedText.substring(0, offset);
                const lastHtmlCommentStart = beforeMatch.lastIndexOf("<!--");
                const lastHtmlCommentEnd = beforeMatch.lastIndexOf("-->");
                const lastTwigCommentStart = beforeMatch.lastIndexOf("{#");
                const lastTwigCommentEnd = beforeMatch.lastIndexOf("#}");

                // If we're inside an HTML comment or Twig comment, don't process this match
                if (
                    lastHtmlCommentStart > lastHtmlCommentEnd ||
                    lastTwigCommentStart > lastTwigCommentEnd
                ) {
                    return match; // Return unchanged
                }

                // Check if this attribute has already been processed by the new Alpine preprocessing
                // Look for pattern like 'attribute="alpine-attr-' or 'attribute="mixed-attr-' after the match
                const afterMatch = processedText.substring(
                    offset + match.length,
                );
                const valueMatch = afterMatch.match(
                    /^\s*=\s*"(alpine-attr-|mixed-attr-)/,
                );
                if (valueMatch) {
                    return match; // Skip - already processed by Alpine preprocessing
                }

                let fullAttributeName;
                if (index === 0) {
                    // For v-on: patterns, captured already includes the full v-on:... part
                    fullAttributeName = captured;
                } else if (index === 1) {
                    // For v-bind: patterns, captured already includes the full v-bind:... part
                    fullAttributeName = captured;
                } else if (index === 2 || index === 3 || index === 4) {
                    // For v-if, x-on:, x- patterns, use as-is
                    fullAttributeName = captured;
                } else if (index === 5) {
                    // For @ patterns, add the @ back
                    fullAttributeName = "@" + captured;
                } else if (index === 6) {
                    // For : patterns, check if this is an XML namespace attribute first
                    const potentialAttributeName = ":" + captured;

                    // Check if this is an XML namespace attribute by looking at the text before the match
                    // We need to check if there's an XML namespace prefix before the colon
                    const textBeforeColon = processedText.substring(
                        Math.max(0, offset - 10),
                        offset,
                    );

                    // Common XML namespace prefixes that should not be treated as Vue attributes
                    const xmlNamespacePattern =
                        /\b(xmlns|xml|xlink|svg|xsi|rdf|rdfs|dc|xs|xsd)$/i;

                    if (xmlNamespacePattern.test(textBeforeColon)) {
                        return match; // Return unchanged for XML namespace attributes
                    }

                    fullAttributeName = potentialAttributeName;
                }

                const replacementId = `data-vue-alpine-${replacementCounter.value++}`;
                replacements.set(replacementId, fullAttributeName);
                return replacementId;
            },
        );
    });

    // Seventh pass: Convert ALL Vue/Alpine attribute values to placeholders
    // This avoids melody-parser having to deal with any problematic characters
    // Handle both single and double quotes with proper nesting
    processedText = processedText.replace(
        /(data-vue-alpine-\d+)=(["'])([^]*?)\2/g,
        (match, attrName, quote, value) => {
            // Check if the value is already a placeholder
            const isPlaceholder = /^twig-attr-value-\d+$/.test(value);

            if (isPlaceholder) {
                // Already a placeholder - return as-is
                return match;
            }

            // Convert the Vue/Alpine attribute value to a placeholder
            const placeholderId = `vue-alpine-value-${replacementCounter.value++}`;

            // Smart quote selection: preserve original quote type when it prevents conflicts
            let finalQuote = '"'; // Default to double quotes

            // If original was single quote and value contains double quotes but no single quotes
            if (quote === "'" && value.includes('"') && !value.includes("'")) {
                finalQuote = "'"; // Keep single quotes to avoid escaping issues
            }

            // If original was double quote and value contains single quotes but no double quotes
            if (quote === '"' && value.includes("'") && !value.includes('"')) {
                finalQuote = '"'; // Keep double quotes
            }

            // In complex cases (both types of quotes present), default to double quotes

            // Store both the value AND the quote character for restoration
            replacements.set(placeholderId, {
                value: value,
                quote: finalQuote,
            });

            return `${attrName}=${finalQuote}${placeholderId}${finalQuote}`;
        },
    );

    // Protect Vue.js template expressions (${...}) from being formatted with line breaks
    // This prevents JavaScript compilation errors in Vue templates
    const vueExpressionRegex = /\$\{([^}]*)\}/g;
    processedText = processedText.replace(
        vueExpressionRegex,
        (match, expression) => {
            // Always process Vue expressions to ensure they stay on one line
            // This prevents Vue compilation errors with string literals containing line breaks
            const vueExpressionId = `vue-expression-${replacementCounter.value++}`;
            // Normalize whitespace but preserve string literal content
            const normalizedExpression =
                normalizeJavaScriptWhitespace(expression);
            replacements.set(vueExpressionId, `\${${normalizedExpression}}`);
            return vueExpressionId;
        },
    );

    // Eighth pass: Convert remaining single-quoted HTML attributes to double quotes
    // This handles any regular HTML attributes that weren't processed by Vue/Alpine logic
    // Use a more robust regex that can handle simple attribute values
    processedText = processedText.replace(
        /(\s+)([\w-]+)='([^']*?)'/g,
        (match, whitespace, attrName, attrValue) => {
            // Simple attribute values that don't contain problematic characters
            // If the value contains quotes or complex structures, skip it
            if (
                attrValue.includes('"') ||
                attrValue.includes("{") ||
                attrValue.includes("}")
            ) {
                return match; // Leave as-is to avoid breaking complex values
            }
            return `${whitespace}${attrName}="${attrValue}"`;
        },
    );

    return { processedText, replacements };
};

const preprocessTwigArrowFunctions = (text) => {
    const replacements = new Map();
    const replacementCounter = { value: 0 };
    let processedText = text;

    // Handle arrow functions inside filter/function call parentheses
    // This regex is designed to handle balanced parentheses better
    // It matches |filter( followed by content that contains => and ends with )
    // The key improvement is using a more careful approach to nested parentheses
    processedText = processedText.replace(
        /(\|\s*\w+\s*\()([^()]*(?:\([^)]*\)[^()]*)*=>[^()]*(?:\([^)]*\)[^()]*)*)\)/g,
        (match, prefix, arrowFunc) => {
            const placeholderId = `__TWIG_ARROW_FUNC_${replacementCounter.value++}__`;
            replacements.set(placeholderId, arrowFunc.trim());
            return `${prefix}${placeholderId})`;
        },
    );

    // Then handle simple arrow functions not in parentheses
    // Pattern: identifier => expression (stopping at |, ), }, or end)
    processedText = processedText.replace(
        /(\w+\s*=>\s*[^%}|,)]+?)(?=\s*[|),}]|$)/g,
        (match) => {
            const placeholderId = `__TWIG_ARROW_FUNC_${replacementCounter.value++}__`;
            replacements.set(placeholderId, match.trim());
            return placeholderId;
        },
    );

    return { processedText, replacements };
};

const createConfiguredLexer = (code, ...extensions) => {
    const lexer = new Lexer(new CharStream(code));
    for (const extension of extensions) {
        if (extension.unaryOperators) {
            lexer.addOperators(
                ...extension.unaryOperators.map((op) => op.text),
            );
        }
        if (extension.binaryOperators) {
            lexer.addOperators(
                ...extension.binaryOperators.map((op) => op.text),
            );
        }
    }
    return lexer;
};

const applyParserExtensions = (parser, ...extensions) => {
    for (const extension of extensions) {
        if (extension.tags) {
            for (const tag of extension.tags) {
                parser.addTag(tag);
            }
        }
        if (extension.unaryOperators) {
            for (const op of extension.unaryOperators) {
                parser.addUnaryOperator(op);
            }
        }
        if (extension.binaryOperators) {
            for (const op of extension.binaryOperators) {
                parser.addBinaryOperator(op);
            }
        }
        if (extension.tests) {
            for (const test of extension.tests) {
                parser.addTest(test);
            }
        }
    }
};

const createConfiguredParser = (code, multiTagConfig, ...extensions) => {
    const parser = new Parser(
        new TokenStream(createConfiguredLexer(code, ...extensions), {
            ignoreWhitespace: true,
            ignoreComments: false,
            ignoreHtmlComments: false,
            applyWhitespaceTrimming: false,
        }),
        {
            ignoreComments: false,
            ignoreHtmlComments: false,
            ignoreDeclarations: false,
            decodeEntities: false,
            multiTags: multiTagConfig,
            allowUnknownTags: true,
        },
    );
    applyParserExtensions(parser, ...extensions);
    return parser;
};

const getMultiTagConfig = (tagsCsvs = []) =>
    tagsCsvs.reduce((acc, curr) => {
        const tagNames = curr.split(",");
        acc[tagNames[0].trim()] = tagNames.slice(1).map((s) => s.trim());
        return acc;
    }, {});

const parse = (text, _parsers, options) => {
    const pluginPaths = getPluginPathsFromOptions(options);
    const multiTagConfig = getMultiTagConfig(options.twigMultiTags || []);
    // Create a modified core extension without the macro parser
    const coreExtensionWithoutMacro = {
        tags: coreExtension.tags.filter((tag) => tag.name !== "macro"),
        unaryOperators: coreExtension.unaryOperators,
        binaryOperators: coreExtension.binaryOperators,
        tests: coreExtension.tests,
    };

    const extensions = [
        enhancedMacroExtension,
        coreExtensionWithoutMacro,
        ...getAdditionalMelodyExtensions(pluginPaths),
    ];
    const { processedText, replacements: vueAlpineReplacements } =
        preprocessVueAlpineAttributes(text);
    const {
        processedText: arrowFuncProcessedText,
        replacements: arrowFuncReplacements,
    } = preprocessTwigArrowFunctions(processedText);
    const parser = createConfiguredParser(
        arrowFuncProcessedText,
        multiTagConfig,
        ...extensions,
    );
    const ast = parser.parse();
    ast[ORIGINAL_SOURCE] = text;
    // Combine replacements while keeping them as Maps
    const combinedReplacements = new Map();
    // Add Vue Alpine replacements
    for (const [key, value] of vueAlpineReplacements) {
        combinedReplacements.set(key, value);
    }
    // Add arrow function replacements
    for (const [key, value] of arrowFuncReplacements) {
        combinedReplacements.set(key, value);
    }
    ast[VUE_ALPINE_REPLACEMENTS] = combinedReplacements;
    return ast;
};

module.exports = {
    parse,
    ORIGINAL_SOURCE,
    VUE_ALPINE_REPLACEMENTS,
    preprocessVueAlpineAttributes,
    preprocessTwigArrowFunctions,
};
