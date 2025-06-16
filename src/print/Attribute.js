const prettier = require("prettier");
const { concat } = prettier.doc.builders;
const { EXPRESSION_NEEDED, STRING_NEEDS_QUOTES } = require("../util");
const { Node } = require("melody-types");

const mayCorrectWhitespace = attrName =>
    ["id", "class", "type"].indexOf(attrName) > -1;

const sanitizeWhitespace = s => s.replace(/\s+/g, " ").trim();

const decodeHtmlEntities = text => {
    // Decode numeric HTML entities back to Unicode characters
    return text.replace(/&#(\d+);/g, (match, dec) => {
        return String.fromCharCode(parseInt(dec, 10));
    });
};

const printConcatenatedString = (valueNode, path, print, ...initialPath) => {
    const printedFragments = [];
    let currentNode = valueNode;
    const currentPath = initialPath;
    while (Node.isBinaryConcatExpression(currentNode)) {
        printedFragments.unshift(path.call(print, ...currentPath, "right"));
        currentPath.push("left");
        currentNode = currentNode.left;
    }
    printedFragments.unshift(path.call(print, ...currentPath));
    return concat(printedFragments);
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

    // Restore original Vue/Alpine attribute name if it was replaced
    if (replacements.has(attributeName)) {
        attributeName = replacements.get(attributeName);
    }

    const docs = [attributeName];
    node[EXPRESSION_NEEDED] = true;
    node[STRING_NEEDS_QUOTES] = false;
    if (node.value) {
        docs.push('="');
        if (
            Node.isBinaryConcatExpression(node.value) &&
            node.value.wasImplicitConcatenation
        ) {
            // Special handling for concatenated string values
            docs.push(
                printConcatenatedString(node.value, path, print, "value")
            );
        } else {
            const isStringValue = Node.isStringLiteral(node.value);
            if (mayCorrectWhitespace(attributeName) && isStringValue) {
                node.value.value = sanitizeWhitespace(node.value.value);
            }

            // Check if this is a Twig attribute value placeholder
            if (isStringValue && replacements.has(node.value.value)) {
                // Replace the placeholder with the original Twig syntax, decode Unicode entities
                const originalValue = replacements.get(node.value.value);
                docs.push(decodeHtmlEntities(originalValue));
            } else if (
                isStringValue &&
                node.value.value.startsWith("twig-attr-value-")
            ) {
                // Handle twig-attr-value placeholders
                if (replacements.has(node.value.value)) {
                    const originalValue = replacements.get(node.value.value);
                    docs.push(decodeHtmlEntities(originalValue));
                } else {
                    docs.push(path.call(print, "value"));
                }
            } else if (replacements.has(node.name.name) && isStringValue) {
                // If this was a Vue/Alpine attribute, decode the HTML entities in the value
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
                docs.push(path.call(print, "value"));
            } else {
                // For regular attributes, decode Unicode entities only if they exist
                if (isStringValue && /&#\d+;/.test(node.value.value)) {
                    const decodedValue = decodeHtmlEntities(node.value.value);
                    docs.push(decodedValue);
                } else {
                    docs.push(path.call(print, "value"));
                }
            }
        }
        docs.push('"');
    }

    return concat(docs);
};

module.exports = {
    printAttribute: p
};
