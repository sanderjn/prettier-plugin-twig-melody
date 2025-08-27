const prettier = require("prettier");
const { concat, line, join, hardline, indent } = prettier.doc.builders;
const {
    isWhitespaceOnly,
    countNewlines,
    createTextGroups,
    PRESERVE_LEADING_WHITESPACE,
    PRESERVE_TRAILING_WHITESPACE,
    NEWLINES_ONLY,
} = require("../util");

const newlinesOnly = (s, preserveWhitespace = true) => {
    const numNewlines = countNewlines(s);
    if (numNewlines === 0) {
        return preserveWhitespace ? line : "";
    } else if (numNewlines === 1) {
        return hardline;
    }
    return concat([hardline, hardline]);
};

const decodeHtmlEntities = (text) => {
    // Add type check and conversion
    if (typeof text !== "string") {
        text = String(text || "");
    }
    // Decode numeric HTML entities back to Unicode characters
    return text.replace(/&#(\d+);/g, (match, dec) => {
        return String.fromCharCode(parseInt(dec, 10));
    });
};

const p = (node, path, print, options) => {
    // Check for special values that might have been
    // computed during preprocessing
    const preserveLeadingWhitespace =
        node[PRESERVE_LEADING_WHITESPACE] === true;
    const preserveTrailingWhitespace =
        node[PRESERVE_TRAILING_WHITESPACE] === true;

    // Get the raw string directly from the node value instead of calling print
    // This ensures we get the placeholder before it's processed by StringLiteral
    let rawString =
        node.value && node.value.value
            ? node.value.value
            : path.call(print, "value");

    // Remove quotes if present (they might be added during parsing)
    if (
        typeof rawString === "string" &&
        rawString.startsWith('"') &&
        rawString.endsWith('"')
    ) {
        rawString = rawString.slice(1, -1);
    }

    // Check if this is a special content placeholder
    const replacements = options.vueAlpineReplacements || new Map();

    // First check for exact match
    if (
        replacements.has(rawString.trim()) &&
        !rawString.trim().startsWith("__HTML_ENTITY_")
    ) {
        const originalContent = replacements.get(rawString.trim());

        // Handle v-pre content - return it exactly as-is with no formatting
        if (rawString.trim().startsWith("v-pre-content-")) {
            return originalContent;
        }

        // Handle Vue template expressions - return them as-is to prevent line breaks
        if (rawString.trim().startsWith("vue-expression-")) {
            return originalContent;
        }

        // Return the original script/style content with indentation preserved
        const decodedContent = decodeHtmlEntities(originalContent);

        // Apply indentation to the content. Since this is inside a script/style tag,
        // it should be indented as if it's a child of the tag
        return indent(concat([hardline, decodedContent.trim(), hardline]));
    }

    // Check for placeholders embedded within the text (partial matches)
    let replacedString = rawString;
    let hasReplacements = false;

    for (const [placeholder, originalContent] of replacements) {
        if (replacedString.includes(placeholder)) {
            // Handle v-pre content - return it exactly as-is
            if (placeholder.startsWith("v-pre-content-")) {
                replacedString = replacedString.replace(
                    placeholder,
                    originalContent,
                );
                hasReplacements = true;
            }
            // Handle Vue template expressions - return them as-is
            else if (placeholder.startsWith("vue-expression-")) {
                replacedString = replacedString.replace(
                    placeholder,
                    originalContent,
                );
                hasReplacements = true;
            }
            // Handle other protected content
            else if (!placeholder.startsWith("__HTML_ENTITY_")) {
                const decodedContent = decodeHtmlEntities(originalContent);
                replacedString = replacedString.replace(
                    placeholder,
                    decodedContent,
                );
                hasReplacements = true;
            }
        }
    }

    // If we found and replaced placeholders, return the processed string
    if (hasReplacements) {
        // Check if the original raw string contained any Vue expression placeholders
        // If so, the text contains Vue expressions and should not be formatted
        let containsVueExpression = false;
        for (const [placeholder] of replacements) {
            if (
                placeholder.startsWith("vue-expression-") &&
                rawString.includes(placeholder)
            ) {
                containsVueExpression = true;
                break;
            }
        }

        if (containsVueExpression) {
            // For Vue expressions, we need to prevent them from being re-formatted
            // Return them as a single concatenated string without line breaks
            return concat([replacedString.trim()]);
        }

        // Apply the same whitespace/newline processing as normal text
        if (isWhitespaceOnly(replacedString) && node[NEWLINES_ONLY]) {
            return newlinesOnly(replacedString);
        }

        const textGroups = createTextGroups(
            replacedString,
            preserveLeadingWhitespace,
            preserveTrailingWhitespace,
        );
        return join(concat([hardline, hardline]), textGroups);
    }

    if (isWhitespaceOnly(rawString) && node[NEWLINES_ONLY]) {
        return newlinesOnly(rawString);
    }

    // First restore any protected HTML entities
    let processedString = rawString;
    let hasRestoredEntities = false;

    for (const [placeholder, entity] of replacements) {
        if (placeholder.startsWith("__HTML_ENTITY_")) {
            if (processedString.includes(placeholder)) {
                processedString = processedString.replace(
                    new RegExp(placeholder, "g"),
                    entity,
                );
                hasRestoredEntities = true;
            }
        }
    }

    // Only decode HTML entities if we haven't restored any protected ones
    // This prevents double-decoding of entities we wanted to preserve
    const decodedString =
        !hasRestoredEntities && /&#\d+;/.test(processedString)
            ? decodeHtmlEntities(processedString)
            : processedString;

    const textGroups = createTextGroups(
        decodedString,
        preserveLeadingWhitespace,
        preserveTrailingWhitespace,
    );

    return join(concat([hardline, hardline]), textGroups);
};

module.exports = {
    printTextStatement: p,
};
