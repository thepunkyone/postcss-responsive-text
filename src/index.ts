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
  },
  PARAM_RANGE = {
    'font-size': 'font-range' as const,
    'line-height': 'line-height-range' as const,
    'letter-spacing': 'letter-spacing-range' as const,
  },
  PARAM_DECLS = {
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

type DeclName = keyof typeof DEFAULT_PARAMS
type DeclNameParamRange = (typeof PARAM_RANGE)[keyof typeof PARAM_RANGE]
type RangeDecl = (typeof PARAM_DECLS)[keyof typeof PARAM_DECLS]
type DefaultParams = (typeof DEFAULT_PARAMS)[keyof typeof DEFAULT_PARAMS]
type Rules = {
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
  return parseFloat(px) / parseFloat(rootSize) + 'rem'
}

function fetchResponsiveSizes(
  rule: Rule,
  declName: DeclName,
  cb: (minSize: string, maxSize: string) => void
): void {
  rule.walkDecls(declName, (decl) => {
    if (decl.value.indexOf('responsive') > -1) {
      const foundSizes = decl.value.match(/-?\d*\.?\d+(?:\w+)?/g)

      if (foundSizes) {
        cb(foundSizes[0], foundSizes[1])
      }
    }
  })
}

function fetchRangeSizes(
  rule: Rule,
  declName: DeclNameParamRange,
  cb: (minSize: string, maxSize: string) => void
) {
  rule.walkDecls(declName, (decl) => {
    const sizes = decl.value.split(/\s+/)

    cb(sizes[0], sizes[1])
    decl.remove()
  })
}

function fetchParams(rule: Rule, declName: DeclName) {
  const params = Object.assign({}, DEFAULT_PARAMS[declName])

  // Fetch params from shorthand declName, i.e., font-size or line-height, etc
  fetchResponsiveSizes(rule, declName, (minSize, maxSize) => {
    params.minSize = minSize
    params.maxSize = maxSize
  })

  // Fetch params from shorthand font-range or line-height-range
  fetchRangeSizes(rule, PARAM_RANGE[declName], (minSize, maxSize) => {
    params.minWidth = minSize
    params.maxWidth = maxSize
  })

  // Fetch parameters from expanded properties
  const rangeDecl: RangeDecl = PARAM_DECLS[declName]

  let key: keyof typeof rangeDecl

  for (key in rangeDecl) {
    rule.walkDecls(rangeDecl[key], (decl) => {
      params[key] = decl.value.trim()
      decl.remove()
    })
  }

  return params
}

function isRule(node: unknown): node is Rule {
  return (<{ type?: unknown }>node).type === 'rule'
}

function isDeclName(declProp: string): declProp is DeclName {
  return Object.keys(DEFAULT_PARAMS).includes(declProp)
}

/**
 * Build new responsive type rules
 * @param  {object} rule     old CSS rule
 * @param declName
 * @param params
 * @param result
 * @return {object}          object of new CSS rules
 */
function buildRules(rule: Rule, declName: DeclName, params: DefaultParams, result: Result) {
  let minSize = params.minSize,
    maxSize = params.maxSize,
    minWidth,
    maxWidth,
    sizeUnit = getUnit(params.minSize),
    maxSizeUnit = getUnit(params.maxSize),
    widthUnit = getUnit(params.minWidth),
    maxWidthUnit = getUnit(params.maxWidth),
    sizeDiff,
    rangeDiff

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
  sizeDiff = parseFloat(maxSize) - parseFloat(minSize)
  rangeDiff = parseFloat(<string>maxWidth) - parseFloat(<string>minWidth)

  let rules: Rules = {
    responsive:
      'calc(' + minSize + ' + ' + sizeDiff + ' * ((100vw - ' + minWidth + ') / ' + rangeDiff + '))',
    // Build the media queries
    minMedia: postcss.atRule({
      name: 'media',
      params: 'screen and (max-width: ' + params.minWidth + ')',
    }),
    maxMedia: postcss.atRule({
      name: 'media',
      params: 'screen and (min-width: ' + params.maxWidth + ')',
    }),
  }

  // Add the required content to new media queries
  rules.minMedia
    .append({
      selector: rule.selector,
    })
    .walkRules((selector) => {
      selector.append({
        prop: declName,
        value: params.minSize,
      })
    })

  rules.maxMedia
    .append({
      selector: rule.selector,
    })
    .walkRules((selector) => {
      selector.append({
        prop: declName,
        value: params.maxSize,
      })
    })

  return rules
}

module.exports = () => {
  return {
    postcssPlugin: 'postcss-responsive-text',
    Once(root: Root, { result }: { result: Result }) {
      root.walkRules(function (rule) {
        // Check root font-size (for rem units)
        if (rule.selector.indexOf('html') > -1) {
          rule.walkDecls('font-size', (decl) => {
            if (decl.value.indexOf('px') > -1) {
              rootSize = decl.value
            }
          })
        }

        rule.walkDecls(/^(font-size|line-height|letter-spacing)$/, (decl) => {
          // If decl doesn't contain responsive keyword, exit
          if (decl.value.indexOf('responsive') === -1) {
            return
          }

          const parentNode = decl.parent

          if (!isRule(parentNode) || !isDeclName(decl.prop)) {
            return
          }

          const params = fetchParams(parentNode, decl.prop)

          const newRules = buildRules(parentNode, decl.prop, params, result)

          // Insert the base responsive declaration
          if (decl.value.indexOf('responsive') > -1) {
            decl.replaceWith({ prop: decl.prop, value: newRules.responsive })
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
