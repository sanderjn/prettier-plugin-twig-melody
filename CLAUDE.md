Guide: Updating @sanderjn/prettier-plugin-twig-melody for Alpine.js Compatibility

Overview

The current Twig Melody parser has issues with Alpine.js syntax patterns commonly used in modern Twig templates. This guide
outlines the specific issues and provides implementation strategies to resolve them.

Current Issues

1. Complex JavaScript Expressions in Attributes

Problem: Parser fails when Alpine.js attributes contain JavaScript with quotes, logical operators, and complex expressions.

Example that fails:

  <div x-show="window.location.hostname === 'staging.example.com' || window.location.hostname === 'localhost'">

Error: Expected stringEnd but found text instead

2. Inline Style Attributes with Semicolons

Problem: Parser cannot handle CSS properties with semicolons in style attributes.

Example that fails:

  <pre style="max-height: 90vh; max-width: 100vw; overflow: scroll;">

  Error: Expected a valid attribute name, but instead found ";"

  3. Alpine.js Data Attributes with Complex Objects

  Problem: Parser struggles with Alpine.js x-data attributes containing JavaScript objects.

  Example that fails:
  <div x-data="{ open: false, items: ['a', 'b'] }" data-testid="component-{{ loop.index }}">

  Implementation Strategy

  1. Tokenizer Updates (melody-parser/lib/index.js)

  A. Enhance Attribute Value Parsing

  Update the TokenStream.matchAttributes method to better handle complex attribute values:

  // In TokenStream.matchAttributes method
  if (this.current.type === TokenType.STRING_START) {
      // Enhanced string parsing for Alpine.js attributes
      if (attrName.startsWith('x-') || attrName.startsWith('@') || attrName === 'style') {
          return this.parseComplexAttributeValue();
      } else {
          return this.parseStandardAttributeValue();
      }
  }

  parseComplexAttributeValue() {
      let depth = 0;
      let value = '';
      let inSingleQuote = false;
      let inDoubleQuote = false;

      while (!this.isEOF()) {
          const char = this.source[this.position];

          // Track quote state
          if (char === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
          if (char === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;

          // Track brace depth only outside quotes
          if (!inSingleQuote && !inDoubleQuote) {
              if (char === '{') depth++;
              if (char === '}') depth--;

              // End of attribute value
              if (char === '"' && depth === 0) break;
          }

          value += char;
          this.position++;
      }

      return { type: 'AttributeValue', value };
  }

  B. Add Alpine.js-Aware CSS Property Parser

  For style attributes, implement CSS-aware parsing:

  parseStyleAttribute() {
      let value = '';
      let inProperty = true;

      while (!this.isEOF() && this.source[this.position] !== '"') {
          const char = this.source[this.position];

          if (char === ':') inProperty = false;
          if (char === ';') {
              inProperty = true;
              // Don't treat semicolon as token separator in CSS context
          }

          value += char;
          this.position++;
      }

      return { type: 'StyleAttribute', value };
  }

  2. Parser Grammar Updates

  A. Extend Attribute Recognition

  Update the parser to recognize Alpine.js attribute patterns:

  // In Parser.matchElement method
  const alpineAttributes = [
      'x-data', 'x-show', 'x-if', 'x-for', 'x-on', 'x-bind',
      'x-model', 'x-text', 'x-html', 'x-transition', 'x-cloak'
  ];

  const isAlpineAttribute = (attrName) => {
      return alpineAttributes.some(prefix =>
          attrName.startsWith(prefix) || attrName.startsWith('@')
      );
  };

  B. Special Handling for Data Attributes

  Add logic for data-testid and similar attributes with Twig expressions:

  parseDataAttribute(attrName, attrValue) {
      if (attrValue.includes('{{') && attrValue.includes('}}')) {
          // Parse as mixed content (static + Twig expression)
          return this.parseMixedAttributeContent(attrValue);
      }
      return { type: 'StaticAttribute', name: attrName, value: attrValue };
  }

  3. AST Node Types

  Add new AST node types to handle Alpine.js patterns:

  // New AST node types
  const AlpineDirective = {
      type: 'AlpineDirective',
      name: String,      // e.g., 'x-show', 'x-data'
      expression: String, // JavaScript expression
      modifiers: Array   // e.g., ['.lazy', '.prevent']
  };

  const MixedAttribute = {
      type: 'MixedAttribute',
      name: String,
      parts: Array // Mix of static strings and Twig expressions
  };

  const StyleAttribute = {
      type: 'StyleAttribute',
      properties: Array // Parsed CSS properties
  };

  4. Printer Updates

  A. Alpine.js Directive Printing

  Update the printer to properly format Alpine.js directives:

  // In printer.js
  case 'AlpineDirective':
      const modifiers = node.modifiers.length > 0 ? node.modifiers.join('') : '';
      return `${node.name}${modifiers}="${node.expression}"`;

  case 'MixedAttribute':
      const formattedParts = node.parts.map(part => {
          if (part.type === 'TwigExpression') {
              return `{{ ${part.expression} }}`;
          }
          return part.value;
      });
      return `${node.name}="${formattedParts.join('')}"`;

  B. Style Attribute Formatting

  Implement proper CSS formatting within style attributes:

  case 'StyleAttribute':
      const formattedProperties = node.properties.map(prop =>
          `${prop.property}: ${prop.value}`
      ).join('; ');
      return `style="${formattedProperties}${formattedProperties ? ';' : ''}"`;

  5. Configuration Options

  Add configuration options to the prettier plugin:

  // In plugin options
  const defaultOptions = {
      twigMelodyAlpineSupport: true,
      twigMelodyPreserveCSSFormat: true,
      twigMelodyAlpineDirectiveSpacing: 'consistent'
  };

  6. Test Cases

  Create comprehensive test cases covering:

  // Test cases to add
  describe('Alpine.js Support', () => {
      test('complex x-show expressions', () => {
          const input = `<div x-show="condition === 'value' || other.check">`;
          const expected = `<div x-show="condition === 'value' || other.check">`;
          expect(format(input)).toBe(expected);
      });

      test('style attributes with multiple properties', () => {
          const input = `<pre style="max-height: 90vh; overflow: scroll;">`;
          const expected = `<pre style="max-height: 90vh; overflow: scroll;">`;
          expect(format(input)).toBe(expected);
      });

      test('data attributes with Twig expressions', () => {
          const input = `<div data-testid="item-{{ loop.index }}">`;
          const expected = `<div data-testid="item-{{ loop.index }}">`;
          expect(format(input)).toBe(expected);
      });
  });

  7. Backwards Compatibility

  Ensure changes don't break existing Twig templates:
  - Add feature flags for new parsing behavior
  - Maintain existing AST structure for non-Alpine templates
  - Provide migration guide for edge cases

  8. Error Handling

  Improve error messages for common Alpine.js issues:

  parseAttributeValue(attrName) {
      try {
          return this.parseComplexAttributeValue();
      } catch (error) {
          if (attrName.startsWith('x-') || attrName.startsWith('@')) {
              throw new Error(
                  `Alpine.js attribute parsing failed for "${attrName}". ` +
                  `Ensure JavaScript expressions are properly quoted.`
              );
          }
          throw error;
      }
  }

  Priority Implementation Order

  1. High Priority: Fix style attribute semicolon parsing
  2. High Priority: Support complex JavaScript expressions in Alpine.js attributes
  3. Medium Priority: Handle mixed Twig/Alpine.js data attributes
  4. Low Priority: Dynamic HTML element support
  5. Low Priority: Advanced Alpine.js modifiers and directives

  Testing Strategy

  1. Test with real-world Alpine.js patterns
  2. Ensure Tailwind CSS integration still works
  3. Verify no regressions in standard Twig templates
  4. Test edge cases with nested quotes and complex expressions

  This implementation will make the plugin fully compatible with modern Alpine.js + Twig development patterns while maintaining
  backwards compatibility.
