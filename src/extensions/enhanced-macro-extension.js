/**
 * Enhanced Macro Parser Extension for Twig Melody
 * This extension adds support for default parameter values in macro definitions
 * as per Twig 3.x specification: https://twig.symfony.com/doc/3.x/tags/macro.html
 */

const { Identifier } = require("melody-types");
const {
    Types,
    setStartFromToken,
    setEndFromToken,
    createNode,
    hasTagStartTokenTrimLeft,
    hasTagEndTokenTrimRight
} = require("melody-parser");
const { MacroDeclarationStatement } = require("melody-extension-core");

/**
 * Enhanced Macro Parameter - represents a macro parameter with optional default value
 */
class MacroParameter {
    constructor(name, defaultValue = null) {
        this.name = name;
        this.defaultValue = defaultValue;
    }
}

const EnhancedMacroParser = {
    name: "macro",
    parse(parser, token) {
        const tokens = parser.tokens;

        const nameToken = tokens.expect(Types.SYMBOL);
        const args = [];

        tokens.expect(Types.LPAREN);
        while (!tokens.test(Types.RPAREN) && !tokens.test(Types.EOF)) {
            const arg = tokens.expect(Types.SYMBOL);
            const paramName = createNode(Identifier, arg, arg.text);

            // Check for default value assignment
            if (tokens.test(Types.ASSIGNMENT)) {
                tokens.next(); // consume the '=' token
                const defaultValue = parser.matchExpression();

                // Store the default value info on the identifier for the printer
                paramName.defaultValue = defaultValue;
                args.push(paramName);
            } else {
                // Regular parameter without default value
                args.push(paramName);
            }

            // Handle comma separation - similar to matchArguments logic
            if (!tokens.test(Types.RPAREN)) {
                if (!tokens.nextIf(Types.COMMA)) {
                    parser.error({
                        title: 'Expected comma or ")"',
                        pos: tokens.la(0).pos,
                        advice:
                            "The argument list of a macro can consist of parameter names separated by commas, with optional default values using = syntax."
                    });
                }
            }
        }
        tokens.expect(Types.RPAREN);

        const openingTagEndToken = tokens.la(0);
        let closingTagStartToken;

        const body = parser.parse((tokenText, token, tokens) => {
            const result = !!(
                token.type === Types.TAG_START &&
                tokens.nextIf(Types.SYMBOL, "endmacro")
            );
            if (result) {
                closingTagStartToken = token;
            }
            return result;
        });

        if (tokens.test(Types.SYMBOL)) {
            const nameEndToken = tokens.next();
            if (nameToken.text !== nameEndToken.text) {
                parser.error({
                    title: `Macro name mismatch, expected "${nameToken.text}" but found "${nameEndToken.text}"`,
                    pos: nameEndToken.pos
                });
            }
        }

        const macroDeclarationStatement = new MacroDeclarationStatement(
            createNode(Identifier, nameToken, nameToken.text),
            args,
            body
        );

        setStartFromToken(macroDeclarationStatement, token);
        setEndFromToken(
            macroDeclarationStatement,
            tokens.expect(Types.TAG_END)
        );

        macroDeclarationStatement.trimRightMacro = hasTagEndTokenTrimRight(
            openingTagEndToken
        );
        macroDeclarationStatement.trimLeftEndmacro = hasTagStartTokenTrimLeft(
            closingTagStartToken
        );

        return macroDeclarationStatement;
    }
};

// Export the enhanced extension
module.exports = {
    tags: [EnhancedMacroParser],
    MacroParameter
};
