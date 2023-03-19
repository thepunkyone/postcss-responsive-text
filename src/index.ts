'use strict'

import { AtRule, Result, Root, Rule } from 'postcss'

/**
 * @type {import('postcss').PluginCreator}
 */

const postcss = require('postcss')

const DEFAULT_PARAMS = {
  'font-size': {
    minSize: '12px',
    maxSize: '21px',
    minWidth: '420px',
    maxWidth: '1280px',
  },
  'line-height': {
    minSize: '1.2em',
    maxSize: '1.8em',
    minWidth: '420px',
    maxWidth: '1280px',
  },
  'letter-spacing': {
    minSize: '0px',
    maxSize: '4px',
    minWidth: '420px',
    maxWidth: '1280px',
  },
}

const PARAM_RANGES = {
  'font-size': 'font-range' as const,
  'line-height': 'line-height-range' as const,
  'letter-spacing': 'letter-spacing-range' as const,
}

const CUSTOM_PARAMS = {
  'font-size': {
    minSize: 'min-font-size' as const,
    maxSize: 'max-font-size' as const,
    minWidth: 'lower-font-range' as const,
    maxWidth: 'upper-font-range' as const,
  },
  'line-height': {
    minSize: 'min-line-height' as const,
    maxSize: 'max-line-height' as const,
    minWidth: 'lower-line-height-range' as const,
    maxWidth: 'upper-line-height-range' as const,
  },
  'letter-spacing': {
    minSize: 'min-letter-spacing' as const,
    maxSize: 'max-letter-spacing' as const,
    minWidth: 'lower-letter-spacing-range' as const,
    maxWidth: 'upper-letter-spacing-range' as const,
  },
}

type CssAttribute = keyof typeof DEFAULT_PARAMS
type CustomRange = (typeof PARAM_RANGES)[keyof typeof PARAM_RANGES]
type CustomAttributes = (typeof CUSTOM_PARAMS)[keyof typeof CUSTOM_PARAMS]
type DefaultParams = (typeof DEFAULT_PARAMS)[keyof typeof DEFAULT_PARAMS]
type CustomRules = {
  responsive: string
  minMedia: AtRule
  maxMedia: AtRule
}

// Assign default root size
let rootSize = '16px'

/**
 * Extract the unit from a string
 * @param  {String} value value to extract unit from
 * @return {String}       unit
 */
function getUnit(value: string): string | null {
  const match = value.match(/px|rem|em/)

  if (match) {
    return match.toString()
  }
  return null
}

/**
 * Px -> Rem converter
 * @param  {String} px pixel value
 * @return {String} rem value
 */
function pxToRem(px: string): string {
  return `${parseFloat(px) / parseFloat(rootSize)}rem`
}

function fetchResponsiveSizes(
  rule: Rule,
  declarationName: CssAttribute,
  cb: (minSize: string, maxSize: string) => void
): void {
  rule.walkDecls(declarationName, (declaration) => {
    if (declaration.value.indexOf('responsive') > -1) {
      const sizes = declaration.value.match(/-?\d*\.?\d+(?:\w+)?/g)

      if (sizes) {
        cb(sizes[0], sizes[1])
      }
    }
  })
}

function fetchRangeSizes(
  rule: Rule,
  declarationName: CustomRange,
  cb: (minSize: string, maxSize: string) => void
) {
  rule.walkDecls(declarationName, (declaration) => {
    const sizes = declaration.value.split(/\s+/)

    cb(sizes[0], sizes[1])
    declaration.remove()
  })
}

function getParams(rule: Rule, declarationName: CssAttribute) {
  const params = Object.assign({}, DEFAULT_PARAMS[declarationName])

  // Fetch params from shorthand declarationName, i.e., font-size or line-height, etc
  fetchResponsiveSizes(rule, declarationName, (minSize, maxSize) => {
    params.minSize = minSize
    params.maxSize = maxSize
  })

  // Fetch params from shorthand font-range or line-height-range
  fetchRangeSizes(rule, PARAM_RANGES[declarationName], (minSize, maxSize) => {
    params.minWidth = minSize
    params.maxWidth = maxSize
  })

  // Fetch parameters from expanded properties
  const customAttributes: CustomAttributes = CUSTOM_PARAMS[declarationName]

  let attribute: keyof typeof customAttributes

  for (attribute in customAttributes) {
    rule.walkDecls(customAttributes[attribute], (declaration) => {
      params[attribute] = declaration.value.trim()
      declaration.remove()
    })
  }

  return params
}

function isRule(node: unknown): node is Rule {
  return (<{ type?: unknown }>node).type === 'rule'
}

function isCssAttribute(attribute: string): attribute is CssAttribute {
  return Object.keys(DEFAULT_PARAMS).includes(attribute)
}

/**
 * Build new responsive type rules
 * @param  {object} rule     old CSS rule
 * @param declarationName
 * @param params
 * @param result
 * @return {object}          object of new CSS rules
 */
function buildRules(
  rule: Rule,
  declarationName: CssAttribute,
  params: DefaultParams,
  result: Result
): CustomRules {
  let minWidth
  let maxWidth
  const minSize = params.minSize
  const maxSize = params.maxSize
  const sizeUnit = getUnit(params.minSize)
  const maxSizeUnit = getUnit(params.maxSize)
  const widthUnit = getUnit(params.minWidth)
  const maxWidthUnit = getUnit(params.maxWidth)

  if (sizeUnit === null) {
    throw rule.error('sizes with unitless values are not supported')
  }

  if (sizeUnit !== maxSizeUnit && widthUnit !== maxWidthUnit) {
    rule.warn(result, 'min/max unit types must match')
  }

  if (sizeUnit === 'rem' && widthUnit === 'px') {
    minWidth = pxToRem(params.minWidth)
    maxWidth = pxToRem(params.maxWidth)
  } else if (sizeUnit === widthUnit || (sizeUnit === 'rem' && widthUnit === 'em')) {
    minWidth = params.minWidth
    maxWidth = params.maxWidth
  } else {
    rule.warn(result, 'this combination of units is not supported')
  }

  // Build the responsive type declaration
  const sizeDifference = parseFloat(maxSize) - parseFloat(minSize)
  const rangeDifference = parseFloat(<string>maxWidth) - parseFloat(<string>minWidth)

  const rules: CustomRules = {
    responsive: `calc(${minSize} + ${sizeDifference} * ((100vw - ${minWidth}) / ${rangeDifference}))`,
    // Build the media queries
    minMedia: postcss.atRule({
      name: 'media',
      params: `screen and (max-width: ${params.minWidth})`,
    }),
    maxMedia: postcss.atRule({
      name: 'media',
      params: `screen and (min-width: ${params.maxWidth})`,
    }),
  }

  // Add the required content to new media queries
  rules.minMedia
    .append({
      selector: rule.selector,
    })
    .walkRules((selector) => {
      selector.append({
        prop: declarationName,
        value: params.minSize,
      })
    })

  rules.maxMedia
    .append({
      selector: rule.selector,
    })
    .walkRules((selector) => {
      selector.append({
        prop: declarationName,
        value: params.maxSize,
      })
    })

  return rules
}

module.exports = () => {
  return {
    postcssPlugin: 'postcss-responsive-text',
    Once(root: Root, { result }: { result: Result }): void {
      root.walkRules(function (rule) {
        // Check root font-size (for rem units)
        if (rule.selector.indexOf('html') > -1) {
          rule.walkDecls('font-size', (declaration) => {
            if (declaration.value.indexOf('px') > -1) {
              rootSize = declaration.value
            }
          })
        }

        rule.walkDecls(/^(font-size|line-height|letter-spacing)$/, (declaration) => {
          // If declaration doesn't contain responsive keyword, exit
          if (declaration.value.indexOf('responsive') === -1) {
            return
          }

          const parentNode = declaration.parent

          // If parent node is not of Rule type or declaration prop is not a valid CSS attribute, exit
          if (!isRule(parentNode) || !isCssAttribute(declaration.prop)) {
            return
          }

          const declarationName = declaration.prop

          const params = getParams(parentNode, declarationName)

          const newRules = buildRules(parentNode, declarationName, params, result)

          // Insert the base responsive declaration
          if (declaration.value.indexOf('responsive') > -1) {
            declaration.replaceWith({ prop: declarationName, value: newRules.responsive })
          }

          // Insert the media queries
          parentNode.parent?.insertAfter(parentNode, newRules.minMedia)
          parentNode.parent?.insertAfter(parentNode, newRules.maxMedia)
        })
      })
    },
  }
}

module.exports.postcss = true
