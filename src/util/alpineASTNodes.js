// AST node types for Alpine.js and enhanced attribute support

const AlpineDirective = {
    type: "AlpineDirective",
    name: "", // e.g., 'x-show', 'x-data'
    expression: "", // JavaScript expression
    modifiers: [], // e.g., ['.lazy', '.prevent']
    originalAttribute: "", // Original attribute name before processing
};

const MixedAttribute = {
    type: "MixedAttribute",
    name: "",
    parts: [], // Mix of static strings and Twig expressions
};

const StyleAttribute = {
    type: "StyleAttribute",
    properties: [], // Parsed CSS properties
    originalValue: "", // Original style string
};

const ComplexAttributeValue = {
    type: "ComplexAttributeValue",
    value: "", // Complex JavaScript or expression content
    attributeType: "", // 'alpine', 'vue', 'twig', 'style', etc.
};

const StaticAttribute = {
    type: "StaticAttribute",
    name: "",
    value: "",
};

const TwigExpression = {
    type: "TwigExpression",
    expression: "", // The Twig expression content without {{ }}
};

const StaticText = {
    type: "StaticText",
    value: "",
};

// Helper function to create an Alpine directive node
const createAlpineDirective = (
    name,
    expression,
    modifiers = [],
    originalAttribute = null,
) => ({
    type: "AlpineDirective",
    name,
    expression,
    modifiers,
    originalAttribute: originalAttribute || name,
});

// Helper function to create a mixed attribute node
const createMixedAttribute = (name, parts) => ({
    type: "MixedAttribute",
    name,
    parts,
});

// Helper function to create a style attribute node
const createStyleAttribute = (properties, originalValue) => ({
    type: "StyleAttribute",
    properties,
    originalValue,
});

// Helper function to create a complex attribute value node
const createComplexAttributeValue = (value, attributeType = "unknown") => ({
    type: "ComplexAttributeValue",
    value,
    attributeType,
});

// Helper function to parse Alpine.js directive name and modifiers
const parseAlpineDirective = (attributeName) => {
    const parts = attributeName.split(".");
    const name = parts[0];
    const modifiers =
        parts.length > 1 ? parts.slice(1).map((mod) => `.${mod}`) : [];

    return { name, modifiers };
};

// Helper function to determine attribute type
const getAttributeType = (attributeName) => {
    if (attributeName.startsWith("x-")) {
        return "alpine";
    }
    if (
        attributeName.startsWith("v-") ||
        attributeName.startsWith("@") ||
        attributeName.startsWith(":")
    ) {
        return "vue";
    }
    if (attributeName === "style") {
        return "style";
    }
    if (
        attributeName.startsWith("data-") ||
        attributeName.includes("{{") ||
        attributeName.includes("{%")
    ) {
        return "twig";
    }
    return "html";
};

module.exports = {
    AlpineDirective,
    MixedAttribute,
    StyleAttribute,
    ComplexAttributeValue,
    StaticAttribute,
    TwigExpression,
    StaticText,
    createAlpineDirective,
    createMixedAttribute,
    createStyleAttribute,
    createComplexAttributeValue,
    parseAlpineDirective,
    getAttributeType,
};
