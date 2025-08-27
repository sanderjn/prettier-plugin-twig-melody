# Guide: Fix prettier-plugin-twig-melody Compatibility with prettier-plugin-tailwindcss

## Problem Summary

The `@sanderjn/prettier-plugin-twig-melody` plugin (v2.1.1) is not compatible with `prettier-plugin-tailwindcss` (v0.6.14). When both plugins are used together:

1. **Tailwind CSS classes are not being sorted** - The tailwindcss plugin's class sorting functionality is completely bypassed
2. **Strange attributes are injected** - The twig-melody plugin adds unwanted attributes like `hoverdata-vue-alpine-0` to elements with hover classes
3. **Plugin order doesn't matter** - Changing the order of plugins in the configuration doesn't resolve the issue

## Current Behavior

### Input:

```twig
<div class="flex-col rounded-lg bg-white p-6 shadow-lg hover:bg-gray-100 mx-auto container max-w-4xl flex items-center">
    <button class="rounded-lg px-4 py-2 text-white bg-blue-500 hover:bg-blue-600 font-medium transition-colors">Click Me</button>
</div>
```

### Current Output (Broken):

```twig
<div class="flex-col rounded-lg bg-white p-6 shadow-lg hoverdata-vue-alpine-0 mx-auto container max-w-4xl flex items-center">
    <button class="rounded-lg px-4 py-2 text-white bg-blue-500 hoverdata-vue-alpine-1 font-medium transition-colors">
        Click Me
    </button>
</div>
```

### Expected Output:

```twig
<div class="container mx-auto flex max-w-4xl flex-col items-center rounded-lg bg-white p-6 shadow-lg hover:bg-gray-100">
    <button class="rounded-lg bg-blue-500 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-600">
        Click Me
    </button>
</div>
```

## Technical Analysis

### Root Cause

The twig-melody plugin appears to:

1. Process and transform the AST in a way that prevents other plugins from accessing or modifying class attributes
2. Have a bug where `hover:` pseudo-classes are incorrectly transformed into `hoverdata-vue-alpine-X` attributes
3. Not properly expose the class attribute strings to the prettier-plugin-tailwindcss for processing

### Plugin Architecture Issue

Prettier plugins work by:

1. Parsing code into an AST
2. Each plugin transforms the AST
3. The final AST is printed back to code

The twig-melody plugin likely:

- Parses Twig templates into its own AST format
- Doesn't properly preserve or expose HTML attribute values for other plugins to process
- Has transformation logic that conflicts with Tailwind's pseudo-class syntax

## Required Fixes for @sanderjn/prettier-plugin-twig-melody

### 1. Fix the hover pseudo-class bug

**Problem:** The plugin transforms `hover:bg-gray-100` into `hoverdata-vue-alpine-0`

**Solution:**

- Review the attribute parsing logic
- Ensure `:` characters in class names are preserved
- Remove any Vue/Alpine.js specific transformations that shouldn't be applied universally

### 2. Enable compatibility with prettier-plugin-tailwindcss

**Problem:** The tailwindcss plugin cannot access or sort the class attributes

**Solution:**

- Implement proper plugin chaining by:
    - Exposing class attribute values as raw strings before other plugins process them
    - Using Prettier's plugin API correctly to allow other plugins to transform attribute values
    - Ensuring the AST structure matches what prettier-plugin-tailwindcss expects

### 3. Preserve attribute ordering from other plugins

**Problem:** Even when plugins are reordered, the tailwindcss sorting doesn't work

**Solution:**

- Check if the plugin is overriding the final output
- Ensure the plugin respects transformations made by other plugins in the chain
- Implement proper `preprocess` and `postprocess` hooks if needed

## Implementation Suggestions

### Option 1: Minimal Fix

```javascript
// In the twig-melody plugin's attribute handler
function handleAttribute(attr) {
    // Don't transform class attributes with special handling
    if (attr.name === "class") {
        // Preserve the raw value for other plugins
        return {
            ...attr,
            value: attr.value, // Keep raw, don't transform
            // Mark for other plugins to process
            __rawValue: attr.value,
        };
    }
    // ... existing logic
}
```

### Option 2: Full Compatibility Mode

```javascript
// Add a compatibility option in the plugin
module.exports = {
    // ... existing plugin code

    options: {
        tailwindcssCompatibility: {
            type: "boolean",
            default: true,
            description:
                "Enable compatibility with prettier-plugin-tailwindcss",
        },
    },

    printers: {
        melody: {
            print(path, options, print) {
                const node = path.getValue();

                // If it's a class attribute and tailwind compatibility is on
                if (
                    options.tailwindcssCompatibility &&
                    isClassAttribute(node)
                ) {
                    // Let tailwindcss plugin handle the sorting
                    return passthrough(node);
                }

                // ... existing print logic
            },
        },
    },
};
```

### Option 3: Use Prettier's Plugin Composition API

```javascript
// Properly implement plugin composition
module.exports = {
    parsers: {
        melody: {
            parse(text, parsers, options) {
                // Parse twig template
                const ast = parseTemplate(text);

                // If tailwindcss plugin is present, delegate class handling
                if (hasTailwindPlugin(options.plugins)) {
                    return transformAstForTailwind(ast);
                }

                return ast;
            },
        },
    },
};
```

## Testing Requirements

Create test cases that verify:

1. **Basic class sorting works**

    ```twig
    <!-- Input -->
    <div class="px-4 flex mx-auto">
    <!-- Should become -->
    <div class="mx-auto flex px-4">
    ```

2. **Pseudo-classes are preserved**

    ```twig
    <!-- Input -->
    <div class="hover:bg-gray-100 focus:outline-none">
    <!-- Should remain with proper sorting -->
    <div class="focus:outline-none hover:bg-gray-100">
    ```

3. **No unwanted attributes are added**

    ```twig
    <!-- Should never produce -->
    <div class="..." hoverdata-vue-alpine-0>
    ```

4. **Works with Twig syntax**
    ```twig
    <div class="{{ baseClasses }} px-4 flex">
    <!-- Classes should still be sorted within the static parts -->
    ```

## Configuration That Should Work

Once fixed, this configuration should properly sort Tailwind classes:

```json
{
    "plugins": [
        "@sanderjn/prettier-plugin-twig-melody",
        "prettier-plugin-tailwindcss"
    ],
    "tailwindConfig": "./tailwind.config.js",
    "tailwindAttributes": ["class"],
    "overrides": [
        {
            "files": "*.twig",
            "options": {
                "parser": "melody"
            }
        }
    ]
}
```

## References

- [Prettier Plugin API Documentation](https://prettier.io/docs/en/plugins.html)
- [prettier-plugin-tailwindcss source](https://github.com/tailwindlabs/prettier-plugin-tailwindcss)
- Current versions tested:
    - `@sanderjn/prettier-plugin-twig-melody`: 2.1.1
    - `prettier-plugin-tailwindcss`: 0.6.14
    - `prettier`: 3.6.2
    - `tailwindcss`: 4.1.11

## Priority

This is a critical issue for any project using:

- Twig templates (common in Symfony, Craft CMS, etc.)
- Tailwind CSS for styling
- Prettier for code formatting

The fix would benefit the entire Twig + Tailwind CSS community.
