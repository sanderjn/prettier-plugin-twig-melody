const { CharStream, Lexer, TokenStream, Parser } = require("melody-parser");
const { extension: coreExtension } = require("melody-extension-core");
const enhancedMacroExtension = require("./extensions/enhanced-macro-extension");
const {
    getAdditionalMelodyExtensions,
    getPluginPathsFromOptions
} = require("./util");

const ORIGINAL_SOURCE = Symbol("ORIGINAL_SOURCE");
const VUE_ALPINE_REPLACEMENTS = Symbol("VUE_ALPINE_REPLACEMENTS");

// Regex patterns for Vue/Alpine.js attributes that cause parsing issues
const VUE_ALPINE_PATTERNS = [
    // Vue.js shorthand directives (e.g., @click="handler", @submit.prevent="handler")
    /@[a-zA-Z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)*(?:="[^"]*"|\s|>)/g,
    // Vue.js v-on with modifiers (e.g., v-on:click.prevent="handler")
    /v-on:[a-zA-Z][a-zA-Z0-9-]*\.[a-zA-Z][a-zA-Z0-9.-]*(?:="[^"]*"|\s|>)/g,
    // Alpine.js x-on with modifiers (e.g., x-on:item-selected.window="handler")
    /x-on:[a-zA-Z][a-zA-Z0-9-]*\.[a-zA-Z][a-zA-Z0-9.-]*(?:="[^"]*"|\s|>)/g,
    // Other Alpine.js attributes with dots (e.g., x-data.foo="value")
    /x-[a-zA-Z][a-zA-Z0-9-]*\.[a-zA-Z][a-zA-Z0-9.-]*(?:="[^"]*"|\s|>)/g
];

const preprocessUnicodeCharacters = text => {
    // Temporarily protect HTML entities from being decoded by melody-parser
    // This is needed because melody-parser decodes entities even with decodeEntities: false
    const entityReplacements = new Map();
    let entityCounter = 0;

    let processedText = text;

    // Protect numeric HTML entities (e.g., &#8206;, &#160;)
    processedText = processedText.replace(/&#\d+;/g, match => {
        const placeholder = `__HTML_ENTITY_${entityCounter++}__`;
        entityReplacements.set(placeholder, match);
        return placeholder;
    });

    // Protect named HTML entities (e.g., &nbsp;, &amp;)
    processedText = processedText.replace(/&[a-zA-Z][a-zA-Z0-9]*;/g, match => {
        const placeholder = `__HTML_ENTITY_${entityCounter++}__`;
        entityReplacements.set(placeholder, match);
        return placeholder;
    });

    return { processedText, entityReplacements };
};

const preprocessVueAlpineAttributes = text => {
    const replacements = new Map();
    let replacementCounter = 0;
    let processedText = text;

    // First pass: Handle v-pre elements - preserve their content completely
    // This must be done before any other processing to ensure v-pre content is untouched
    // Use a smart regex that matches any valid HTML element with v-pre directive

    // Match any HTML element with v-pre directive
    // Pattern explanation:
    // - ([a-zA-Z][a-zA-Z0-9-]*) captures the element name (must start with letter, can contain letters, numbers, hyphens)
    // - ([^>]*?\bv-pre\b[^>]*) captures the full opening tag attributes including v-pre
    // - ([\s\S]*?) captures the element content (non-greedy, matches any character including newlines)
    // - <\/\1\s*> matches the closing tag using backreference to the opening tag name
    const vPreRegex = /<([a-zA-Z][a-zA-Z0-9-]*)([^>]*?\bv-pre\b[^>]*)>([\s\S]*?)<\/\1\s*>/gi;

    processedText = processedText.replace(
        vPreRegex,
        (match, elementName, attributes, content) => {
            // Store the entire v-pre content as-is
            const vPreContentId = `v-pre-content-${replacementCounter++}`;
            replacements.set(vPreContentId, content);

            // Return the element with a placeholder for its content
            // Use plain text that won't be parsed as template syntax
            return `<${elementName}${attributes}>${vPreContentId}</${elementName}>`;
        }
    );

    // Second pass: Protect HTML entities from being decoded by melody-parser
    const {
        processedText: entityProtectedText,
        entityReplacements
    } = preprocessUnicodeCharacters(processedText);
    processedText = entityProtectedText;

    // Merge entity replacements into main replacements map
    for (const [placeholder, entity] of entityReplacements) {
        replacements.set(placeholder, entity);
    }

    // Third pass: Protect script and style tag content from being formatted
    // This preserves JavaScript/CSS code as-is
    processedText = processedText.replace(
        /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
        (match, tagName, attributes, content) => {
            const placeholderId = `${tagName.toLowerCase()}-content-${replacementCounter++}`;
            replacements.set(placeholderId, content);
            return `<${tagName}${attributes}>${placeholderId}</${tagName}>`;
        }
    );
    // Fourth pass: Handle inline Twig conditionals in HTML element tags
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

            // Skip processing if this doesn't contain Twig blocks
            if (!elementContent.includes("{%")) {
                return match;
            }

            let processedContent = elementContent;

            // Handle standalone Twig conditional blocks in element tags
            // Convert them to temporary attributes that melody-parser can understand
            processedContent = processedContent.replace(
                /\{%\s*if\s+[^%]+?%\}[^<>]*?\{%\s*endif\s*%\}/g,
                block => {
                    // Only process if it's not inside quotes
                    const beforeBlock = processedContent.substring(
                        0,
                        processedContent.indexOf(block)
                    );
                    const quoteCount = (beforeBlock.match(/"/g) || []).length;

                    // Only replace if we're not inside a quoted attribute value (even number of quotes)
                    if (quoteCount % 2 === 0) {
                        const placeholderId = `data-twig-conditional-${replacementCounter++}`;
                        replacements.set(placeholderId, block);
                        return `${placeholderId}="1"`; // Use "1" as a placeholder value
                    }
                    return block; // Leave unchanged if inside quotes
                }
            );

            // Then handle HTML attribute values that contain Twig syntax
            // This regex is more careful to only match actual HTML attributes by ensuring
            // we're inside an HTML element context (surrounded by < and >)
            processedContent = processedContent.replace(
                /(\w+)="([^"]*(?:\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\})[^"]*)"/g,
                (match, attrName, attrValue) => {
                    const placeholderId = `twig-attr-value-${replacementCounter++}`;
                    replacements.set(placeholderId, attrValue);
                    return `${attrName}="${placeholderId}"`;
                }
            );

            return `<${processedContent}>`;
        }
    );

    // Fifth pass: Handle Vue/Alpine.js attributes that cause parsing issues
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
        /:([a-zA-Z][a-zA-Z0-9-]*)(?=\s*=|\s|>)/g
    ];

    patterns.forEach((pattern, index) => {
        processedText = processedText.replace(
            pattern,
            (match, captured, offset) => {
                // Check if this match is inside an HTML comment
                const beforeMatch = processedText.substring(0, offset);
                const lastCommentStart = beforeMatch.lastIndexOf("<!--");
                const lastCommentEnd = beforeMatch.lastIndexOf("-->");

                // If we're inside an HTML comment, don't process this match
                if (lastCommentStart > lastCommentEnd) {
                    return match; // Return unchanged
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
                    // For : patterns, add the : back
                    fullAttributeName = ":" + captured;
                }

                const replacementId = `data-vue-alpine-${replacementCounter++}`;
                replacements.set(replacementId, fullAttributeName);
                return replacementId;
            }
        );
    });

    // Sixth pass: Convert ALL Vue/Alpine attribute values to placeholders
    // This avoids melody-parser having to deal with any problematic characters
    processedText = processedText.replace(
        /(data-vue-alpine-\d+)="([^"]*)"/g,
        (match, attrName, value) => {
            // Check if the value is already a placeholder
            const isPlaceholder = /^twig-attr-value-\d+$/.test(value);

            if (isPlaceholder) {
                // Already a placeholder - return as-is
                return match;
            }

            // Convert the Vue/Alpine attribute value to a placeholder
            const placeholderId = `vue-alpine-value-${replacementCounter++}`;
            replacements.set(placeholderId, value);
            return `${attrName}="${placeholderId}"`;
        }
    );

    // Protect Vue.js template expressions (${...}) from being formatted with line breaks
    // This prevents JavaScript compilation errors in Vue templates
    const vueExpressionRegex = /\$\{([^}]*)\}/g;
    processedText = processedText.replace(
        vueExpressionRegex,
        (match, expression) => {
            // Only process expressions that contain line breaks or excessive whitespace
            if (expression.includes("\n") || /\s{2,}/.test(expression)) {
                const vueExpressionId = `vue-expression-${replacementCounter++}`;
                // Normalize whitespace but preserve the expression structure
                const normalizedExpression = expression
                    .replace(/\s+/g, " ")
                    .trim();
                replacements.set(
                    vueExpressionId,
                    `\${${normalizedExpression}}`
                );
                return vueExpressionId;
            }
            return match;
        }
    );

    return { processedText, replacements };
};

const createConfiguredLexer = (code, ...extensions) => {
    const lexer = new Lexer(new CharStream(code));
    for (const extension of extensions) {
        if (extension.unaryOperators) {
            lexer.addOperators(...extension.unaryOperators.map(op => op.text));
        }
        if (extension.binaryOperators) {
            lexer.addOperators(...extension.binaryOperators.map(op => op.text));
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
            applyWhitespaceTrimming: false
        }),
        {
            ignoreComments: false,
            ignoreHtmlComments: false,
            ignoreDeclarations: false,
            decodeEntities: false,
            multiTags: multiTagConfig,
            allowUnknownTags: true
        }
    );
    applyParserExtensions(parser, ...extensions);
    return parser;
};

const getMultiTagConfig = (tagsCsvs = []) =>
    tagsCsvs.reduce((acc, curr) => {
        const tagNames = curr.split(",");
        acc[tagNames[0].trim()] = tagNames.slice(1).map(s => s.trim());
        return acc;
    }, {});

const parse = (text, parsers, options) => {
    const pluginPaths = getPluginPathsFromOptions(options);
    const multiTagConfig = getMultiTagConfig(options.twigMultiTags || []);
    // Create a modified core extension without the macro parser
    const coreExtensionWithoutMacro = {
        tags: coreExtension.tags.filter(tag => tag.name !== "macro"),
        unaryOperators: coreExtension.unaryOperators,
        binaryOperators: coreExtension.binaryOperators,
        tests: coreExtension.tests
    };

    const extensions = [
        enhancedMacroExtension,
        coreExtensionWithoutMacro,
        ...getAdditionalMelodyExtensions(pluginPaths)
    ];
    const { processedText, replacements } = preprocessVueAlpineAttributes(text);
    const parser = createConfiguredParser(
        processedText,
        multiTagConfig,
        ...extensions
    );
    const ast = parser.parse();
    ast[ORIGINAL_SOURCE] = text;
    ast[VUE_ALPINE_REPLACEMENTS] = replacements;
    return ast;
};

module.exports = {
    parse,
    ORIGINAL_SOURCE,
    VUE_ALPINE_REPLACEMENTS,
    preprocessVueAlpineAttributes
};
