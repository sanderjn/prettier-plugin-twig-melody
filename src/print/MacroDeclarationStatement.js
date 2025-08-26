const prettier = require("prettier");
const { group, join, concat, line, softline, hardline, indent } =
    prettier.doc.builders;
const { STRING_NEEDS_QUOTES } = require("../util");

const printArgument = (arg, index, path, print) => {
    if (arg.defaultValue) {
        // Parameter with default value - similar to NamedArgumentExpression
        const paramName = path.call(print, "arguments", index, "name");
        const defaultValueDoc = path.call(
            print,
            "arguments",
            index,
            "defaultValue",
        );

        return concat([paramName, " = ", defaultValueDoc]);
    }
    // Regular parameter - just print the identifier
    return path.call(print, "arguments", index);
};

const printOpener = (node, path, print) => {
    const parts = [
        node.trimLeft ? "{%-" : "{%",
        " macro ",
        path.call(print, "name"),
        "(",
    ];

    // Enhanced argument printing to support default values
    const mappedArguments = [];
    for (let i = 0; i < node.arguments.length; i++) {
        const arg = node.arguments[i];
        mappedArguments.push(printArgument(arg, i, path, print));
    }

    const joinedArguments = join(concat([",", line]), mappedArguments);
    parts.push(indent(concat([softline, joinedArguments])));
    parts.push(")", line, node.trimRightMacro ? "-%}" : "%}");
    return group(concat(parts));
};

const p = (node, path, print) => {
    // Set flag to ensure string literals in default values are quoted
    node[STRING_NEEDS_QUOTES] = true;

    const parts = [printOpener(node, path, print)];
    parts.push(indent(concat([hardline, path.call(print, "body")])));
    parts.push(
        hardline,
        node.trimLeftEndmacro ? "{%-" : "{%",
        " endmacro ",
        node.trimRight ? "-%}" : "%}",
    );
    return concat(parts);
};

module.exports = {
    printMacroDeclarationStatement: p,
};
