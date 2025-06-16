const {
    firstValueInAncestorChain,
    quoteChar,
    STRING_NEEDS_QUOTES,
    OVERRIDE_QUOTE_CHAR
} = require("../util");

const isUnmaskedOccurrence = (s, pos) => {
    return pos === 0 || s[pos - 1] !== "\\";
};

const containsUnmasked = char => s => {
    let pos = s.indexOf(char);
    while (pos >= 0) {
        if (isUnmaskedOccurrence(s, pos)) {
            return true;
        }
        pos = s.indexOf(char, pos + 1);
    }
    return false;
};

const containsUnmaskedSingleQuote = containsUnmasked("'");
const containsUnmaskedDoubleQuote = containsUnmasked('"');

const getQuoteChar = (s, options) => {
    if (containsUnmaskedSingleQuote(s)) {
        return '"';
    }
    if (containsUnmaskedDoubleQuote(s)) {
        return "'";
    }
    return quoteChar(options);
};

const p = (node, path, print, options) => {
    // The structure this string literal is part of
    // determines if we need quotes or not
    const needsQuotes = firstValueInAncestorChain(
        path,
        STRING_NEEDS_QUOTES,
        false
    );
    // In case of a string with interpolations, only double quotes
    // are allowed. This is then indicated by OVERRIDE_QUOTE_CHAR
    // in an ancestor.
    const overridingQuoteChar = firstValueInAncestorChain(
        path,
        OVERRIDE_QUOTE_CHAR,
        null
    );

    // Restore HTML entity placeholders before processing
    let value = node.value;
    const replacements = options.vueAlpineReplacements || new Map();

    for (const [placeholder, entity] of replacements) {
        if (placeholder.startsWith("__HTML_ENTITY_")) {
            if (value.includes(placeholder)) {
                value = value.replace(new RegExp(placeholder, "g"), entity);
            }
        }
    }

    if (needsQuotes) {
        const quote = overridingQuoteChar
            ? overridingQuoteChar
            : getQuoteChar(value, options);
        return quote + value + quote;
    }

    return value;
};

module.exports = {
    printStringLiteral: p
};
