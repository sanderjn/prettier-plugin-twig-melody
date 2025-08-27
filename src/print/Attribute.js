const prettier = require("prettier");
const { concat, group } = prettier.doc.builders;
const {
    EXPRESSION_NEEDED,
    STRING_NEEDS_QUOTES,
    INSIDE_ATTRIBUTE_VALUE,
    OVERRIDE_QUOTE_CHAR,
} = require("../util");
const { Node } = require("melody-types");

const mayCorrectWhitespace = (attrName) =>
    ["id", "type", "class"].indexOf(attrName) > -1;

const sanitizeWhitespace = (s) => s.replace(/\s+/g, " ").trim();




const decodeHtmlEntities = (text) => {
    // Decode numeric HTML entities back to Unicode characters
    return text.replace(/&#(\d+);/g, (match, dec) => {
        return String.fromCharCode(parseInt(dec, 10));
    });
};

const printConcatenatedString = (valueNode, path, print, ...initialPath) => {
    const printedFragments = [];
    let currentNode = valueNode;
    const currentPath = initialPath;

    // Set the flag on all nodes in the concatenation chain
    let node = valueNode;
    while (Node.isBinaryConcatExpression(node)) {
        node[INSIDE_ATTRIBUTE_VALUE] = true;
        if (node.left) {
            node.left[INSIDE_ATTRIBUTE_VALUE] = true;
        }
        if (node.right) {
            node.right[INSIDE_ATTRIBUTE_VALUE] = true;
        }
        node = node.left;
    }

    while (Node.isBinaryConcatExpression(currentNode)) {
        printedFragments.unshift(path.call(print, ...currentPath, "right"));
        currentPath.push("left");
        currentNode = currentNode.left;
    }
    printedFragments.unshift(path.call(print, ...currentPath));
    return group(concat(printedFragments));
};

const p = (node, path, print, options) => {
    node[EXPRESSION_NEEDED] = false;

    // Check if the attribute name is a Vue/Alpine replacement or Twig conditional replacement
    const replacements = options.vueAlpineReplacements || new Map();
    let attributeName = node.name.name;

    // Handle Twig conditional placeholders - these should be restored as plain text
    if (attributeName.startsWith("data-twig-conditional-")) {
        if (replacements.has(attributeName)) {
            // Return the original Twig conditional block without wrapping it as an attribute
            return replacements.get(attributeName);
        }
    }

    // Handle Twig comment placeholders - these should be restored as plain text
    if (attributeName.startsWith("data-twig-comment-")) {
        if (replacements.has(attributeName)) {
            // Return the original Twig comment block without wrapping it as an attribute
            return replacements.get(attributeName);
        }
    }

    // Handle Alpine.js attribute name placeholders
    if (
        attributeName.startsWith("data-alpine-pure-") ||
        attributeName.startsWith("data-alpine-mixed-")
    ) {
        if (replacements.has(attributeName)) {
            attributeName = replacements.get(attributeName);
        }
    }

    // Restore original Vue/Alpine attribute name if it was replaced
    if (replacements.has(attributeName)) {
        attributeName = replacements.get(attributeName);
    }

    const docs = [attributeName];
    node[EXPRESSION_NEEDED] = true;
    node[STRING_NEEDS_QUOTES] = false;
    node[INSIDE_ATTRIBUTE_VALUE] = true;
    if (node.value) {
        // Determine the quote character to use
        let quoteChar = '"'; // Default to double quotes

        // Check if this is a Vue/Alpine value placeholder with stored quote info
        const isStringValue = Node.isStringLiteral(node.value);
        if (isStringValue && node.value.value.startsWith("vue-alpine-value-")) {
            const storedData = replacements.get(node.value.value);
            if (
                storedData &&
                typeof storedData === "object" &&
                storedData.quote
            ) {
                quoteChar = storedData.quote;
            }
        }

        docs.push("=" + quoteChar);
        if (
            Node.isBinaryConcatExpression(node.value) &&
            node.value.wasImplicitConcatenation
        ) {
            // Special handling for concatenated string values
            node.value[INSIDE_ATTRIBUTE_VALUE] = true;
            docs.push(
                printConcatenatedString(node.value, path, print, "value"),
            );
        } else {
            // Set the flag on the value node
            if (node.value) {
                node.value[INSIDE_ATTRIBUTE_VALUE] = true;
            }
            const isStringValue = Node.isStringLiteral(node.value);

            // Handle attributes with whitespace correction
            if (mayCorrectWhitespace(attributeName) && isStringValue) {
                node.value.value = sanitizeWhitespace(node.value.value);
            }

            // Check if this is a mixed Twig/Alpine.js attribute
            if (isStringValue && node.value.value.startsWith("mixed-attr-")) {
                if (replacements.has(node.value.value)) {
                    const mixedData = replacements.get(node.value.value);
                    if (mixedData.type === "MixedAttribute") {
                        // Restore Twig expressions in the processed value
                        let restoredValue = mixedData.processedValue;
                        mixedData.twigExpressions.forEach((expr, index) => {
                            const placeholder = `__TWIG_EXPR_${index}__`;
                            restoredValue = restoredValue.replace(
                                placeholder,
                                `{{ ${expr} }}`,
                            );
                        });
                        docs.push(
                            group(concat([decodeHtmlEntities(restoredValue)])),
                        );
                    } else {
                        // Fallback to original value if something went wrong
                        docs.push(
                            group(
                                concat([
                                    decodeHtmlEntities(mixedData.originalValue),
                                ]),
                            ),
                        );
                    }
                } else {
                    docs.push(group(path.call(print, "value")));
                }
            } else if (
                isStringValue &&
                node.value.value.startsWith("alpine-attr-")
            ) {
                // Handle pure Alpine.js attributes
                if (replacements.has(node.value.value)) {
                    const alpineData = replacements.get(node.value.value);
                    if (alpineData.type === "AlpineAttribute") {
                        docs.push(
                            group(
                                concat([
                                    decodeHtmlEntities(
                                        alpineData.originalValue,
                                    ),
                                ]),
                            ),
                        );
                    } else {
                        // Fallback
                        docs.push(group(path.call(print, "value")));
                    }
                } else {
                    docs.push(group(path.call(print, "value")));
                }
            } else if (isStringValue && replacements.has(node.value.value)) {
                // Replace the placeholder with the original Twig syntax, decode Unicode entities
                const storedData = replacements.get(node.value.value);
                let originalValue;

                // Handle both old string format and new object format
                if (typeof storedData === "object" && storedData.value) {
                    originalValue = storedData.value;
                } else {
                    originalValue = storedData; // Fallback for old format
                }

                docs.push(group(concat([decodeHtmlEntities(originalValue)])));
            } else if (
                isStringValue &&
                node.value.value.startsWith("twig-attr-value-")
            ) {
                // Handle twig-attr-value placeholders
                if (replacements.has(node.value.value)) {
                    const storedData = replacements.get(node.value.value);
                    let originalValue;

                    // Handle both old string format and new object format
                    if (typeof storedData === "object" && storedData.value) {
                        originalValue = storedData.value;
                    } else {
                        originalValue = storedData; // Fallback for old format
                    }

                    docs.push(
                        group(concat([decodeHtmlEntities(originalValue)])),
                    );
                } else {
                    docs.push(group(path.call(print, "value")));
                }
            } else if (
                attributeName.startsWith("data-vue-alpine-") &&
                isStringValue
            ) {
                // If this was a Vue/Alpine attribute, decode the HTML entities in the value
                // but preserve the original quote character information

                // Check for quote character information in the value placeholder
                let originalQuoteStored = false;
                if (node.value.value.startsWith("vue-alpine-value-")) {
                    const storedData = replacements.get(node.value.value);
                    if (
                        storedData &&
                        typeof storedData === "object" &&
                        storedData.quote
                    ) {
                        quoteChar = storedData.quote;
                        originalQuoteStored = true;
                    }
                }

                node.value.value = node.value.value
                    .replace(/&amp;/g, "&") // Restore ampersands
                    .replace(/&quot;/g, '"') // Restore double quotes
                    .replace(/&#39;/g, "'") // Restore single quotes
                    .replace(/&#33;/g, "!") // Restore exclamation marks
                    .replace(/&#61;/g, "=") // Restore equals signs
                    .replace(/&lt;/g, "<") // Restore less than
                    .replace(/&gt;/g, ">") // Restore greater than
                    .replace(/&#123;/g, "{") // Restore opening braces
                    .replace(/&#125;/g, "}") // Restore closing braces
                    .replace(/&#40;/g, "(") // Restore opening parentheses
                    .replace(/&#41;/g, ")") // Restore closing parentheses
                    .replace(/&#91;/g, "[") // Restore opening brackets
                    .replace(/&#93;/g, "]") // Restore closing brackets
                    .replace(/&#43;/g, "+") // Restore plus signs
                    .replace(/&#45;/g, "-") // Restore minus signs
                    .replace(/&#42;/g, "*") // Restore asterisks
                    .replace(/&#47;/g, "/") // Restore forward slashes
                    .replace(/&#37;/g, "%") // Restore percent signs
                    .replace(/&#63;/g, "?") // Restore question marks
                    .replace(/&#58;/g, ":") // Restore colons
                    .replace(/&#59;/g, ";") // Restore semicolons
                    .replace(/&#44;/g, ",") // Restore commas
                    .replace(/&#124;/g, "|") // Restore pipe characters
                    .replace(/&#36;/g, "$") // Restore dollar signs
                    .replace(/&#64;/g, "@") // Restore at signs
                    .replace(/&#35;/g, "#") // Restore hash signs
                    .replace(/&#94;/g, "^") // Restore caret signs
                    .replace(/&#126;/g, "~") // Restore tilde signs
                    .replace(/&#96;/g, "`"); // Restore backticks

                // If we have the original quote character stored, use it directly
                // Otherwise, let the normal StringLiteral processing handle it
                if (originalQuoteStored) {
                    // Set the override quote character for the StringLiteral printer
                    node.value[OVERRIDE_QUOTE_CHAR] = quoteChar;
                    node.value[STRING_NEEDS_QUOTES] = true;
                }

                docs.push(group(path.call(print, "value")));
            } else {
                // For regular attributes, decode Unicode entities only if they exist
                if (isStringValue && /&#\d+;/.test(node.value.value)) {
                    const decodedValue = decodeHtmlEntities(node.value.value);
                    docs.push(group(concat([decodedValue])));
                } else {
                    docs.push(group(path.call(print, "value")));
                }
            }
        }
        docs.push(quoteChar);
    }

    return group(concat(docs));
};

module.exports = {
    printAttribute: p,
};
