const prettier = require("prettier");
const { concat, line, join, hardline, indent } = prettier.doc.builders;
const {
    isWhitespaceOnly,
    countNewlines,
    createTextGroups,
    PRESERVE_LEADING_WHITESPACE,
    PRESERVE_TRAILING_WHITESPACE,
    NEWLINES_ONLY
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

const decodeHtmlEntities = text => {
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
                    entity
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
        preserveTrailingWhitespace
    );

    return join(concat([hardline, hardline]), textGroups);
};

module.exports = {
    printTextStatement: p
};
