// @flow
const {
  GraphQLDirective,
  DirectiveLocation,
  specifiedDirectives,
} = require(`graphql`)

const { link, fileByPath } = require(`../resolvers`)
const { getDateResolver } = require(`../types/date`)

import type { GraphQLFieldConfigArgumentMap, GraphQLFieldConfig } from "graphql"
import type { ComposeFieldConfig, ComposeOutputType } from "graphql-compose"

export interface GraphQLFieldExtensionDefinition {
  name: string;
  type?: ComposeOutputType;
  args?: GraphQLFieldConfigArgumentMap;
  extend(
    args: GraphQLFieldConfigArgumentMap,
    prevFieldConfig: GraphQLFieldConfig
  ): $Shape<ComposeFieldConfig>;
}

const inferExtensionName = `infer`
const dontInferExtensionName = `dontInfer`

const typeExtensions = {
  [inferExtensionName]: {
    description: `Infer field types from field values.`,
    args: {
      noDefaultResolvers: {
        type: `Boolean`,
        description: `Don't add default resolvers to defined fields.`,
        deprecationReason: `noDefaultResolvers is deprecated, annotate individual fields.`,
      },
    },
  },
  [dontInferExtensionName]: {
    description: `Do not infer field types from field values.`,
    args: {
      noDefaultResolvers: {
        type: `Boolean`,
        description: `Don't add default resolvers to defined fields.`,
        deprecationReason: `noDefaultResolvers is deprecated, annotate individual fields.`,
      },
    },
  },
  mimeTypes: {
    description: `Define the mime-types handled by this type.`,
    args: {
      types: {
        type: `[String!]!`,
        defaultValue: [],
        description: `The mime-types handled by this type.`,
      },
    },
  },
  childOf: {
    description:
      `Define parent-child relations between types. This is used to add ` +
      `\`child*\` or \`children*\` convenience fields like \`childImageSharp\`.`,
    args: {
      mimeTypes: {
        type: `[String!]!`,
        defaultValue: [],
        description:
          `A list of mime-types this type is a child of. Usually these are ` +
          `the mime-types handled by a transformer plugin.`,
      },
      types: {
        type: `[String!]!`,
        defaultValue: [],
        description:
          `A list of types this type is a child of. Usually these are the ` +
          `types handled by a transformer plugin.`,
      },
      many: {
        type: `Boolean!`,
        defaultValue: false,
        description: `Specifies whether a parent can have multiple children of this type or not.`,
      },
    },
  },
  nodeInterface: {
    description:
      `Adds root query fields for an interface. All implementing types ` +
      `must also implement the Node interface.`,
    locations: [DirectiveLocation.INTERFACE],
  },
}

const builtInFieldExtensions = {
  dateformat: {
    name: `dateformat`,
    description: `Add date formatting options.`,
    args: {
      formatString: `String`,
      locale: `String`,
      fromNow: `Boolean`,
      difference: `String`,
    },
    extend(args, fieldConfig) {
      return getDateResolver(args, fieldConfig)
    },
  },

  link: {
    name: `link`,
    description: `Link to node by foreign-key relation.`,
    args: {
      by: {
        type: `String!`,
        defaultValue: `id`,
      },
      from: `String`,
      on: `String`,
    },
    extend(args, fieldConfig, schemaComposer) {
      const type = args.on && schemaComposer.typeMapper.getWrapped(args.on)
      return {
        resolve: link({ ...args, type }, fieldConfig),
      }
    },
  },

  fileByRelativePath: {
    name: `fileByRelativePath`,
    description: `Link to File node by relative path.`,
    args: {
      from: `String`,
    },
    extend(args, fieldConfig) {
      return {
        resolve: fileByPath(args, fieldConfig),
      }
    },
  },

  proxy: {
    name: `proxy`,
    description: `Proxy resolver from another field.`,
    args: {
      from: `String!`,
      fromNode: {
        type: `Boolean!`,
        defaultValue: false,
      },
    },
    extend(options, fieldConfig) {
      return {
        resolve(source, args, context, info) {
          const resolver = fieldConfig.resolve || context.defaultFieldResolver
          return resolver(source, args, context, {
            ...info,
            from: options.from || info.from,
            fromNode: options.from ? options.fromNode : info.fromNode,
          })
        },
      }
    },
  },
}

// Reserved for internal use
const internalExtensionNames = [
  `createdFrom`,
  `default`,
  `directives`,
  `infer`,
  `plugin`,
  ...specifiedDirectives.map(directive => directive.name),
]
const reservedExtensionNames = [
  ...internalExtensionNames,
  ...Object.keys(builtInFieldExtensions),
]

const toDirectives = ({
  schemaComposer,
  extensions,
  locations: defaultLocations,
}) =>
  Object.keys(extensions).map(name => {
    const extension = extensions[name]
    const { args, description, locations, type } = extension
    // Allow field extensions to register a return type
    if (type) {
      schemaComposer.createTC(type)
    }
    // Support the `graphql-compose` style of directly providing the field type as string
    const normalizedArgs = schemaComposer.typeMapper.convertArgConfigMap(args)
    return new GraphQLDirective({
      name,
      args: normalizedArgs,
      description,
      locations: locations || defaultLocations,
    })
  })

const addDirectives = ({ schemaComposer, fieldExtensions = {} }) => {
  const fieldDirectives = toDirectives({
    schemaComposer,
    extensions: fieldExtensions,
    locations: [DirectiveLocation.FIELD_DEFINITION],
  })
  fieldDirectives.forEach(directive => schemaComposer.addDirective(directive))
  const typeDirectives = toDirectives({
    schemaComposer,
    extensions: typeExtensions,
    locations: [DirectiveLocation.OBJECT],
  })
  typeDirectives.forEach(directive => schemaComposer.addDirective(directive))
}

const processFieldExtensions = ({
  fieldExtensions = {},
  schemaComposer,
  typeComposer,
  parentSpan,
}) => {
  typeComposer.getFieldNames().forEach(fieldName => {
    const extensions = typeComposer.getFieldExtensions(fieldName)
    Object.keys(extensions)
      .filter(name => !internalExtensionNames.includes(name))
      .forEach(name => {
        const { extend } = fieldExtensions[name] || {}
        if (typeof extend === `function`) {
          // Always get fresh field config as it will have been changed
          // by previous field extension
          const prevFieldConfig = typeComposer.getFieldConfig(fieldName)
          typeComposer.extendField(
            fieldName,
            extend(extensions[name], prevFieldConfig, schemaComposer)
          )
        }
      })
  })
}

module.exports = {
  addDirectives,
  builtInFieldExtensions,
  internalExtensionNames,
  processFieldExtensions,
  reservedExtensionNames,
  inferExtensionName,
  dontInferExtensionName,
}
