const prettier = require("prettier");
const { group, concat } = prettier.doc.builders;
const { EXPRESSION_NEEDED, wrapExpressionIfNeeded } = require("../util");

const p = (node, path, print, options) => {
    node[EXPRESSION_NEEDED] = false;

    let name = node.name;

    // Check for arrow function placeholders and restore them
    const replacements = options.vueAlpineReplacements || new Map();
    if (
        name &&
        name.startsWith("__TWIG_ARROW_FUNC_") &&
        replacements &&
        typeof replacements.has === "function" &&
        replacements.has(name)
    ) {
        name = replacements.get(name);
    }

    const parts = [name];
    wrapExpressionIfNeeded(path, parts, node);
    const result = concat(parts);
    return parts.length === 1 ? result : group(result);
};

module.exports = {
    printIdentifier: p
};
