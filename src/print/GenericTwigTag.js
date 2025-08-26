const prettier = require("prettier");
const { concat, hardline, indent } = prettier.doc.builders;
const { Node } = require("melody-types");
const {
    STRING_NEEDS_QUOTES,
    indentWithHardline,
    printSingleTwigTag,
    isEmptySequence,
} = require("../util");

const p = (node, path, print) => {
    node[STRING_NEEDS_QUOTES] = true;
    const openingTag = printSingleTwigTag(node, path, print);
    const parts = [openingTag];
    const printedSections = path.map(print, "sections");

    // Check if this is a switch statement
    const isSwitch = node.tagName === "switch";

    node.sections.forEach((section, i) => {
        if (Node.isGenericTwigTag(section)) {
            if (isSwitch) {
                // Special handling for switch statements
                if (section.tagName === "endswitch") {
                    // endswitch at same level as switch
                    parts.push(concat([hardline, printedSections[i]]));
                } else if (
                    section.tagName === "case" ||
                    section.tagName === "default"
                ) {
                    // case and default tags indented relative to switch
                    parts.push(indentWithHardline(printedSections[i]));
                } else {
                    parts.push(concat([hardline, printedSections[i]]));
                }
            } else {
                parts.push(concat([hardline, printedSections[i]]));
            }
        } else {
            if (!isEmptySequence(section)) {
                if (isSwitch) {
                    // Content inside switch cases should be double-indented
                    parts.push(indent(indentWithHardline(printedSections[i])));
                } else {
                    // Regular indentation
                    parts.push(indentWithHardline(printedSections[i]));
                }
            }
        }
    });
    return concat(parts);
};

module.exports = {
    printGenericTwigTag: p,
};
