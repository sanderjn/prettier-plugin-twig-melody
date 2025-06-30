const prettier = require("prettier");
const {
    concat,
    group,
    line,
    hardline,
    softline,
    indent,
    join
} = prettier.doc.builders;
const {
    removeSurroundingWhitespace,
    isInlineElement,
    printChildGroups,
    EXPRESSION_NEEDED,
    STRING_NEEDS_QUOTES
} = require("../util");
const { Node } = require("melody-types");

const hasComplexValue = (attribute, options) => {
    if (!attribute.value) {
        return false;
    }

    // Check attribute name for Vue.js directives and other framework attributes
    const replacements =
        options && options.vueAlpineReplacements
            ? options.vueAlpineReplacements
            : new Map();
    let attrName = attribute.name;

    // If attribute.name is an object with a 'name' property, extract it
    if (typeof attrName === "object" && attrName.name) {
        attrName = attrName.name;
    }

    // Get the original attribute name if it was replaced during parsing
    if (replacements.has(attrName)) {
        attrName = replacements.get(attrName);
    }

    if (typeof attrName === "string") {
        // Vue.js directives (v-on, v-bind, v-model, etc.)
        if (
            attrName.startsWith("v-") ||
            attrName.startsWith("@") ||
            attrName.startsWith(":")
        ) {
            return true;
        }

        // Alpine.js directives
        if (attrName.startsWith("x-") || attrName.startsWith("@")) {
            return true;
        }

        // Angular directives
        if (
            attrName.startsWith("(") ||
            attrName.startsWith("[") ||
            attrName.startsWith("*")
        ) {
            return true;
        }
    }

    // Check if it's a binary concatenation (Twig expressions mixed with strings)
    if (
        Node.isBinaryConcatExpression &&
        Node.isBinaryConcatExpression(attribute.value)
    ) {
        return true;
    }

    // Check if it's not a simple string literal
    if (!Node.isStringLiteral(attribute.value)) {
        return true;
    }

    // Check if the string contains Twig expressions
    const value = attribute.value.value;
    if (typeof value === "string") {
        // Twig expressions
        if (value.includes("{{") || value.includes("{%")) {
            return true;
        }

        // JavaScript-like expressions in attribute values (common in Vue/Alpine)
        if (
            value.includes("=") ||
            value.includes("!") ||
            value.includes("&&") ||
            value.includes("||")
        ) {
            return true;
        }

        // Function calls or complex expressions
        if (value.includes("(") && value.includes(")")) {
            return true;
        }
    }

    return false;
};

const shouldBreakAttributes = (node, options) => {
    if (!node.attributes || node.attributes.length === 0) {
        return false;
    }

    // Always break if there are many attributes
    if (node.attributes.length > 2) {
        return true;
    }

    // Break if any attribute has complex values
    return node.attributes.some(attr => hasComplexValue(attr, options));
};

const printOpeningTag = (node, path, print, options) => {
    const opener = "<" + node.name;
    const printedAttributes = printSeparatedList(path, print, "", "attributes");
    const openingTagEnd = node.selfClosing ? " />" : ">";
    const hasAttributes = node.attributes && node.attributes.length > 0;

    if (hasAttributes) {
        const shouldBreak = shouldBreakAttributes(node, options);

        if (shouldBreak) {
            // Break attributes to new lines with proper indentation
            return group(
                concat([
                    opener,
                    indent(concat([line, printedAttributes])),
                    openingTagEnd
                ])
            );
        }
        // Keep attributes inline
        return group(concat([opener, " ", printedAttributes, openingTagEnd]));
    }
    return concat([opener, openingTagEnd]);
};

const printSeparatedList = (path, print, separator, attrName) => {
    return join(concat([separator, line]), path.map(print, attrName));
};

const p = (node, path, print, options) => {
    // Set a flag in case attributes contain, e.g., a FilterExpression
    node[EXPRESSION_NEEDED] = true;
    const openingGroup = group(printOpeningTag(node, path, print, options));
    node[EXPRESSION_NEEDED] = false;
    node[STRING_NEEDS_QUOTES] = false;

    if (!node.selfClosing) {
        node.children = removeSurroundingWhitespace(node.children);

        const childGroups = printChildGroups(node, path, print, "children");

        // Check if we have only empty placeholder children (like script-content-X or similar)
        const hasOnlyEmptyPlaceholders =
            node.children &&
            node.children.length > 0 &&
            node.children.every(child => {
                // Check if it's a PrintTextStatement with a placeholder value for empty content
                if (
                    child.type === "PrintTextStatement" &&
                    child.value &&
                    child.value.type === "StringLiteral" &&
                    child.value.value &&
                    child.value.value.match(/^(script|style)-content-\d+$/)
                ) {
                    // Check if the replacement map has this placeholder and if its content is empty
                    const replacements =
                        options && options.vueAlpineReplacements
                            ? options.vueAlpineReplacements
                            : new Map();

                    const placeholderKey = child.value.value;
                    if (replacements.has(placeholderKey)) {
                        const content = replacements.get(placeholderKey);
                        // Only consider it empty if content is actually empty or only whitespace
                        return !content || !content.trim();
                    }
                    // If no replacement found, consider it empty
                    return true;
                }
                return false;
            });

        const closingTag = concat(["</", node.name, ">"]);
        const result = [openingGroup];
        const joinedChildren = concat(childGroups);

        // If element is empty (no children) or has only empty placeholders, keep it on the same line
        if (childGroups.length === 0 || hasOnlyEmptyPlaceholders) {
            result.push(closingTag);
            return group(concat(result));
        }

        if (isInlineElement(node)) {
            result.push(indent(concat([softline, joinedChildren])), softline);
        } else {
            const childBlock = [];
            if (childGroups.length > 0) {
                childBlock.push(hardline);
            }
            childBlock.push(joinedChildren);
            result.push(indent(concat(childBlock)));
            if (childGroups.length > 0) {
                result.push(hardline);
            }
        }
        result.push(closingTag);

        return isInlineElement(node) ? group(concat(result)) : concat(result);
    }

    return openingGroup;
};

module.exports = {
    printElement: p
};
