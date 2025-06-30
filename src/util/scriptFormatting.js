const prettier = require("prettier");

/**
 * Checks if code contains Twig expressions that would make it invalid JavaScript
 * @param {string} code - The code to check
 * @returns {boolean} - True if code has complex Twig expressions
 */
const hasComplexTwigExpressions = code => {
    // Check for patterns that would break JavaScript syntax
    const problematicPatterns = [
        /=\s*\{%.*?%\}/g, // Assignment with Twig statements
        /\{%.*?%\}\s*\{.*?\}/g, // Twig statements followed by objects/arrays
        /\{\{.*?\}\}\s*\{.*?\}/g, // Twig expressions followed by objects/arrays
        /\{%.*?%\}\s*\[.*?\]/g, // Twig statements followed by arrays
        /\{\{.*?\}\}\s*\[.*?\]/g // Twig expressions followed by arrays
    ];

    return problematicPatterns.some(pattern => pattern.test(code));
};

/**
 * Adds proper indentation to formatted code
 * @param {string} code - The formatted code
 * @param {string} indent - The indentation string to use
 * @returns {string} - Code with proper indentation
 */
const addIndentation = (code, indent = "        ") => {
    if (!code.trim()) {
        return code;
    }

    const lines = code.split("\n");
    return lines
        .map((line, index) => {
            // Don't indent empty lines
            if (!line.trim()) {
                return line;
            }
            // Add indentation to all non-empty lines
            return indent + line;
        })
        .join("\n");
};

/**
 * Formats JavaScript code using Prettier
 * @param {string} code - The JavaScript code to format
 * @param {object} options - Prettier options
 * @returns {string} - Formatted JavaScript code
 */
const formatJavaScript = (code, options = {}) => {
    try {
        // Skip formatting if the code has complex Twig expressions
        if (hasComplexTwigExpressions(code)) {
            return code.trim();
        }

        const jsOptions = {
            parser: "babel",
            printWidth: options.printWidth || 80,
            tabWidth: options.tabWidth || 2,
            useTabs: options.useTabs || false,
            semi: options.semi !== false,
            singleQuote: options.singleQuote || false,
            quoteProps: options.quoteProps || "as-needed",
            trailingComma: options.trailingComma || "es5",
            bracketSpacing: options.bracketSpacing !== false,
            bracketSameLine: options.bracketSameLine || false,
            arrowParens: options.arrowParens || "always",
            // Don't add extra newlines at the end
            endOfLine: "lf"
        };

        const formatted = prettier.format(code, jsOptions).trim();

        // Return the formatted code without adding indentation
        // The printer will handle indentation properly
        return formatted;
    } catch (error) {
        // If formatting fails, return the original code
        console.warn("Failed to format JavaScript:", error.message);
        return code;
    }
};

/**
 * Checks if code contains Twig expressions that would make it invalid CSS
 * @param {string} code - The code to check
 * @returns {boolean} - True if code has complex Twig expressions
 */
const hasComplexTwigInCSS = code => {
    // Check for Twig expressions in CSS that could break parsing
    const twigInCSSPatterns = [
        /\{\{[\s\S]*?\}\}/g, // {{ expressions }}
        /\{%[\s\S]*?%\}/g, // {% statements %}
        /\{#[\s\S]*?#\}/g // {# comments #}
    ];

    return twigInCSSPatterns.some(pattern => pattern.test(code));
};

/**
 * Formats CSS code using Prettier
 * @param {string} code - The CSS code to format
 * @param {object} options - Prettier options
 * @returns {string} - Formatted CSS code
 */
const formatCSS = (code, options = {}) => {
    try {
        // Skip formatting if the code has Twig expressions
        if (hasComplexTwigInCSS(code)) {
            return code.trim();
        }

        const cssOptions = {
            parser: "css",
            printWidth: options.printWidth || 80,
            tabWidth: options.tabWidth || 2,
            useTabs: options.useTabs || false,
            singleQuote: options.singleQuote || false,
            // Don't add extra newlines at the end
            endOfLine: "lf"
        };

        const formatted = prettier.format(code, cssOptions).trim();

        // Return the formatted code without adding indentation
        // The printer will handle indentation properly
        return formatted;
    } catch (error) {
        // If formatting fails, return the original code
        console.warn("Failed to format CSS:", error.message);
        return code;
    }
};

/**
 * Protects Twig expressions within code by replacing them with placeholders
 * @param {string} code - The code containing Twig expressions
 * @returns {object} - Object with processedCode and replacements map
 */
const protectTwigExpressions = code => {
    const replacements = new Map();
    let counter = 0;
    let processedCode = code;

    // Protect Twig expressions: {{ ... }}, {% ... %}, {# ... #}
    // Use string literals as placeholders to ensure valid JavaScript syntax
    const twigPatterns = [
        /\{%[\s\S]*?%\}/g, // {% statements %} - process first as they can be more complex
        /\{\{[\s\S]*?\}\}/g, // {{ expressions }}
        /\{#[\s\S]*?#\}/g // {# comments #}
    ];

    twigPatterns.forEach(pattern => {
        processedCode = processedCode.replace(pattern, match => {
            const placeholder = `"__TWIG_EXPR_${counter++}__"`;
            replacements.set(placeholder, match);
            return placeholder;
        });
    });

    return { processedCode, replacements };
};

/**
 * Restores Twig expressions from placeholders
 * @param {string} formattedCode - The formatted code with placeholders
 * @param {Map} replacements - Map of placeholders to original expressions
 * @returns {string} - Code with Twig expressions restored
 */
const restoreTwigExpressions = (formattedCode, replacements) => {
    let restoredCode = formattedCode;

    for (const [placeholder, originalExpr] of replacements) {
        // Handle the comment-style placeholders
        restoredCode = restoredCode.replace(
            new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
            originalExpr
        );
    }

    return restoredCode;
};

/**
 * Formats JavaScript code while preserving Twig expressions
 * @param {string} code - The JavaScript code to format
 * @param {object} options - Prettier options
 * @returns {string} - Formatted JavaScript code with Twig expressions preserved
 */
const formatJavaScriptWithTwig = (code, options = {}) => {
    // Always skip JavaScript formatting to prevent syntax errors with Twig expressions
    // Just preserve the original formatting without adding indentation
    // The printer will handle indentation properly
    return code.trim();
};

/**
 * Formats CSS code while preserving Twig expressions
 * @param {string} code - The CSS code to format
 * @param {object} options - Prettier options
 * @returns {string} - Formatted CSS code with Twig expressions preserved
 */
const formatCSSWithTwig = (code, options = {}) => {
    // Always skip CSS formatting to prevent syntax errors with Twig expressions
    // Just preserve the original formatting without adding indentation
    // The printer will handle indentation properly
    return code.trim();
};

module.exports = {
    formatJavaScript,
    formatCSS,
    formatJavaScriptWithTwig,
    formatCSSWithTwig,
    protectTwigExpressions,
    restoreTwigExpressions,
    hasComplexTwigExpressions,
    hasComplexTwigInCSS
};
