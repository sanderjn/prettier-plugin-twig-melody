# Improving Tailwind CSS Compatibility in @sanderjn/prettier-plugin-twig-melody

## Problem Statement

The `@sanderjn/prettier-plugin-twig-melody` plugin currently has compatibility issues with `prettier-plugin-tailwindcss`. While both plugins work individually, when used together:

- ✅ **Twig formatting works**: Proper indentation, syntax formatting
- ✅ **Tailwind works in HTML**: Classes get sorted in `.html` files
- ❌ **Tailwind fails in Twig**: Classes don't get sorted in `.twig` files

## Root Cause Analysis

The issue occurs because:

1. **Plugin Order Dependency**: Prettier processes plugins sequentially
2. **AST Transformation**: The melody parser transforms the AST in a way that the Tailwind plugin cannot recognize or process class attributes
3. **Attribute Processing**: The Tailwind plugin expects standard HTML-like class attributes but may not handle Twig's enhanced attribute syntax

## Current Working Configuration

```json
{
    "plugins": [
        "prettier-plugin-tailwindcss",
        "@sanderjn/prettier-plugin-twig-melody"
    ],
    "tailwindStylesheet": "./assets/css/tailwind.css",
    "overrides": [
        {
            "files": ["*.twig"],
            "options": {
                "parser": "melody"
            }
        }
    ]
}
```

## Technical Requirements for Compatibility

### 1. Preserve Class Attribute Structure

The Twig plugin should ensure that HTML class attributes remain in a format that the Tailwind plugin can process:

```twig
<!-- This should work -->
<div class="bg-red-500 text-white p-4">

<!-- This should also work -->
<div class="{{ 'bg-red-500 text-white p-4' }}">

<!-- And this -->
<div class="base-class {{ dynamic_classes }}">
```

### 2. AST Node Preservation

Key AST nodes that must be preserved for Tailwind compatibility:

- **Attribute nodes** with `name: "class"`
- **String literal values** containing CSS classes
- **Template expressions** that resolve to class strings

### 3. Plugin Communication

The Twig plugin should either:

- **Option A**: Process the AST but leave class attributes untouched for downstream processing
- **Option B**: Implement direct integration with the Tailwind plugin's sorting logic

## Implementation Approaches

### Approach 1: Attribute Passthrough (Recommended)

Modify the Twig plugin to:

1. **Identify class attributes** during AST processing
2. **Mark them for preservation** - don't modify their content
3. **Let Tailwind plugin process them** after Twig formatting is complete

```javascript
// Pseudo-code for the Twig plugin
function processAttribute(node) {
    if (node.name === "class" || node.name === "className") {
        // Mark this attribute to be processed by other plugins
        node._preserveForDownstreamPlugins = true;
        return node; // Don't modify the content
    }
    // Process other attributes normally
}
```

### Approach 2: Direct Integration

Import and use Tailwind's sorting logic directly:

```javascript
// Import Tailwind sorting function
import { sortClasses } from "prettier-plugin-tailwindcss";

function processClassAttribute(classValue) {
    // Only sort if it's a static string
    if (typeof classValue === "string") {
        return sortClasses(classValue);
    }
    return classValue; // Leave dynamic classes alone
}
```

### Approach 3: Plugin Ordering Fix

Ensure the Twig plugin runs **after** the Tailwind plugin by:

1. **Detecting Tailwind plugin presence**
2. **Yielding processing** for class attributes
3. **Resuming** Twig-specific formatting after Tailwind processing

## Code Integration Points

### In the Melody Parser Extension

Look for these areas in your codebase:

1. **Attribute processing functions**
2. **AST node transformation logic**
3. **String literal handling**

### Key Functions to Modify

Based on typical Prettier plugin architecture:

```javascript
// Example integration points
export const printers = {
    melody: {
        print(path, options, print) {
            const node = path.getValue();

            if (node.type === "Attribute" && node.name === "class") {
                // Special handling for class attributes
                return handleClassAttribute(node, options);
            }

            // Normal processing for other nodes
            return normalPrint(path, options, print);
        },
    },
};
```

## Testing Strategy

### Test Cases to Implement

1. **Static classes**: `class="bg-red-500 text-white p-4"`
2. **Mixed classes**: `class="static-class {{ dynamic_var }}"`
3. **Twig expressions**: `class="{{ condition ? 'class-a' : 'class-b' }}"`
4. **Multiple attributes**: `class="..." id="..." data-attr="..."`
5. **Complex Twig syntax**: Loops, conditions, includes

### Expected Behavior

```twig
<!-- Input -->
<div class="p-4 bg-red-500 text-white rounded shadow-lg hover:bg-red-600">

<!-- Expected Output -->
<div class="rounded bg-red-500 p-4 text-white shadow-lg hover:bg-red-600">
```

## Configuration Options

Add these options to your plugin:

```typescript
interface TwigMelodyOptions {
    // Enable/disable Tailwind compatibility mode
    tailwindCompatibility?: boolean;

    // Attributes to preserve for other plugins
    preserveAttributes?: string[];

    // Whether to sort classes in Twig expressions
    sortTwigClasses?: boolean;
}
```

## Debugging Tools

Implement debug logging:

```javascript
function debugClassProcessing(node, action) {
    if (process.env.PRETTIER_DEBUG_TWIG) {
        console.log(`[Twig Plugin] ${action}:`, {
            type: node.type,
            name: node.name,
            value: node.value,
        });
    }
}
```

## Plugin Dependencies

Update your `package.json` to declare peer dependency:

```json
{
    "peerDependencies": {
        "prettier-plugin-tailwindcss": ">=0.6.0"
    },
    "peerDependenciesMeta": {
        "prettier-plugin-tailwindcss": {
            "optional": true
        }
    }
}
```

## Error Handling

Handle cases where:

- Tailwind plugin is not installed
- Invalid class syntax
- Conflicting plugin configurations

## Migration Guide

For users upgrading:

1. **Update both plugins** to compatible versions
2. **Remove plugin ordering** from overrides (let global order work)
3. **Test with existing Twig templates**

## Success Metrics

The fix is working when:

- ✅ Twig syntax formatting still works perfectly
- ✅ Static Tailwind classes get sorted: `"p-4 bg-red-500"` → `"bg-red-500 p-4"`
- ✅ Dynamic classes are preserved: `"static {{ dynamic }}"` remains functional
- ✅ Performance impact is minimal
- ✅ No breaking changes to existing Twig functionality

This integration would make your plugin the go-to solution for Twig + Tailwind development workflows.
