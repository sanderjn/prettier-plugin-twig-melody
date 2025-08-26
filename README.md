# Prettier for Melody

![Prettier Banner](https://raw.githubusercontent.com/prettier/prettier-logo/master/images/prettier-banner-light.png)

---

This Plugin enables Prettier to format `.twig` files, as well as `.html.twig` and `.melody.twig`. [Melody](https://melody.js.org) is a component based UI framework that uses Twig as its template language.

## Recent Improvements

### Version 1.0.5

This version includes significant enhancements for modern frontend development:

#### 🎯 Vue.js & Alpine.js Integration

- **Full directive support**: All Vue.js and Alpine.js directives are now properly recognized and formatted
- **Smart v-pre handling**: Content inside `v-pre` elements is preserved exactly as written, with support for any HTML element
- **Template expression protection**: Vue.js template expressions (`${ ... }`) are protected from line breaks to prevent JavaScript compilation errors
- **Future-proof element detection**: Uses intelligent regex patterns instead of hardcoded element lists

#### 🔧 Enhanced Parser

- **Smart regex implementation**: Automatically supports any valid HTML element name pattern
- **Comprehensive attribute handling**: Properly processes complex Vue/Alpine attribute combinations
- **Performance optimized**: Efficient processing with minimal overhead

#### ✅ Production Ready

- **Extensive testing**: 89 test suites covering all scenarios
- **Backwards compatible**: No breaking changes to existing functionality
- **Real-world tested**: Handles complex production templates with mixed Twig/Vue.js syntax

## Install

```bash
yarn add --dev @rawwee/prettier-plugin-twig-melody
```

## Use

```bash
prettier --write "**/*.melody.twig"
```

In your editor, if the plugin is not automatically picked up and invoked (e.g., if you are using format on save, but no formatting is happening when you save), try adding the plugin explicitly in your Prettier configuration (e.g., `.prettierrc.json`) using the `plugins` key:

```json
{
    "printWidth": 80,
    "tabWidth": 4,
    "plugins": ["@sanderjn/prettier-plugin-twig-melody"]
}
```

## Options

This Prettier plugin comes with some options that you can add to your Prettier configuration (e.g., `prettierrc.json`).

### twigSingleQuote (default: `true`)

Values can be `true` or `false`. If `true`, single quotes will be used for string literals in Twig files.

### twigMelodyPlugins (default: `[]`)

An array containing file paths to plugin directories. This can be used to add your own printers and parser extensions.

The paths are relative paths, seen from the project root. Example:

```json
"twigMelodyPlugins": ["src-js/some-melody-plugin", "src-js/some-other-plugin"]
```

### twigPrintWidth (default: `80`)

Because Twig files might have a lot of nesting, it can be useful to define a separate print width for Twig files. This can be done with this option. If it is not set, the standard `printWidth` option is used.

### twigAlwaysBreakObjects (default: `false`)

If set to `true`, objects will always be wrapped/broken, even if they would fit on one line:

```html
<section
    class="{{ {
    base: css.prices
} | classes }}"
></section>
```

If set to `false` (default value), this would be printed as:

```html
<section class="{{ { base: css.prices } | classes }}"></section>
```

### twigFollowOfficialCodingStandards (default: `true`)

Follow the standards described in [https://twig.symfony.com/doc/2.x/coding_standards.html](https://twig.symfony.com/doc/2.x/coding_standards.html) exactly. If set to `false`, some slight deviations might occur, such as spaces around the filter `|` operator (`s | upper` instead of `s|upper`).

### twigOutputEndblockName (default: `false`)

Choose whether to output the block name in `{% endblock %}` tags (e.g., `{% endblock content %}`) or not. The default is not to output it.

### twigMultiTags (default: `[]`)

An array of coherent sequences of non-standard Twig tags that should be treated as belonging together. Example (inspired by [Craft CMS](https://docs.craftcms.com/v2/templating/nav.html)):

```json
twigMultiTags: [
    "nav,endnav",
    "switch,case,default,endswitch",
    "ifchildren,endifchildren",
    "cache,endcache"
]
```

Looking at the case of `nav,endnav`, this means that the Twig tags `{% nav %}` and `{% endnav %}` will be treated as a pair, and everything in between will be indented:

```twig
{% nav entry in entries %}
    <li>
        <a href="{{ entry.url }}">{{ entry.title }}</a>
    </li>
{% endnav %}
```

If we did not list the `"nav,endnav"` entry in `twigMultiTags`, this code example would be printed without indentation, because `{% nav %}` and `{% endnav %}` would be treated as unrelated, individual Twig tags:

```twig
{% nav entry in entries %}
<li>
    <a href="{{ entry.url }}">{{ entry.title }}</a>
</li>
{% endnav %}
```

Note that the order matters: It has to be `"nav,endnav"`, and it must not be `"endnav,nav"`. In general, the first and the last tag name matter. In the case of `"switch,case,default,endswitch"`, the order of `case` and `default` does not matter. However, `switch` has to come first, and `endswitch` has to come last.

## Features

### Vue.js and Alpine.js Support

This plugin provides comprehensive support for Vue.js and Alpine.js directives when used in Twig templates, making it perfect for modern frontend frameworks integrated with Twig.

#### Supported Vue.js Directives

All Vue.js directives are fully supported and properly formatted:

- **Basic directives**: `v-model`, `v-show`, `v-if`, `v-else`, `v-for`, `v-html`, `v-text`
- **Event handlers**: `v-on:click`, `v-on:submit`, `@click`, `@submit`
- **Attribute binding**: `v-bind:class`, `v-bind:style`, `:class`, `:style`, `:href`
- **Modifiers**: `v-model.lazy`, `v-on:click.prevent`, `@keyup.enter`
- **Custom directives**: Any directive following Vue.js naming conventions

#### Special v-pre Directive Handling

The `v-pre` directive receives special treatment to preserve raw content exactly as written:

```twig
<!-- Content inside v-pre is preserved exactly as-is -->
<div v-pre>
    {{ raw_content_not_processed }}
    <span   class="preserve-spacing"   >{{ unformatted }}</span>
    {% if condition %}Raw Twig syntax preserved{% endif %}
</div>

<!-- Regular content is formatted normally -->
<div>
    {{ formatted_content }}
    <span class="normalized-spacing">{{ processed }}</span>
    {% if condition %}
        Formatted Twig syntax
    {% endif %}
</div>
```

#### Vue.js Template Expression Protection

Vue.js template expressions (`${ ... }`) are automatically protected from line breaks to prevent JavaScript compilation errors:

```twig
<!-- This problematic expression is automatically fixed -->
<span>${ car.field_compareModelRemoveTitleSpace == true ? car.title : ' ' + car.title }</span>

<!-- Expressions remain on single lines for valid JavaScript -->
<span>${car.field_compareModelRemoveTitleSpace == true ? car.title : ' ' + car.title}</span>
```

#### Alpine.js Directives

All Alpine.js directives are supported with proper formatting:

- **Basic directives**: `x-data`, `x-show`, `x-if`, `x-for`, `x-html`, `x-text`
- **Event handlers**: `x-on:click`, `@click`, `@submit`
- **Attribute binding**: `x-bind:class`, `:class`, `:style`
- **Modifiers**: `x-on:click.prevent`, `@keyup.enter`

#### Smart Element Detection

The plugin uses intelligent regex patterns to support:

- **All standard HTML elements** (div, span, input, button, etc.)
- **HTML5 semantic elements** (article, section, figure, details, etc.)
- **Custom elements** (my-component, custom-element, etc.)
- **Any valid HTML element name pattern** (future-proof)

### `prettier-ignore` and `prettier-ignore-start`

When you are not happy with how Prettier formats a certain element or section in the code, you can tell it to leave it in peace:

```twig
{# prettier-ignore #}
<div   class="weird-formatting"   >This will not be re-formatted</div>

<div   class="weird-formatting"   >But this will be</div>
```

You can also tell Prettier to leave entire regions as they are:

```twig
{# prettier-ignore-start #}
    ...
{# prettier-ignore-end #}
```

## Plugins

[Melody](https://melody.js.org) features an extensible parser, so chances are you add custom elements for which the parsing and printing logic is not part of this Prettier plugin. Therefore, this Prettier plugin is itself pluggable.

Let's look at an example of a plugin to the plugin:

```javascript
const melodyIconPlugin = require("../melody-plugin-icon-tag");

const printIconTag = (node, path, print, options) => {
    // Implementation of printing
    // ...
};

module.exports = {
    melodyExtensions: [melodyIconPlugin],
    printers: {
        IconTag: printIconTag
    }
};
```

As we can see, a plugin to the plugin exports two fields:

- `melodyExtensions`: A list of extensions to the [Melody](https://melody.js.org) framework that might export `tags`, `visitors`, `functionMap` and the like. Usually, such an extension will add additional parsing functionality to the core parser.
- `printers`: The Prettier printing functionality for your additional language constructs, tags, operators, etc. This is an object where the keys are the node types in the Melody AST (abstract syntax tree) &mdash; as retrieved through `node.constructor.name` &mdash;, and the values are the print functions with the standard Prettier signature.

Don't forget to make your plugins known through the `twigMelodyPlugins` option in your Prettier configuration.

## Testing

- You can call `yarn test` to test against all regular tests
