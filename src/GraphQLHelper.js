const { GraphQLScalarType } = require('graphql');
const { Kind } = require('graphql/language');

const SequelizeDataTypeMapper = require('./SequelizeDataTypeMapper');

function parseModel(sequelizeModel) {
    const modelName = sequelizeModel.name;
    const modelAttributes = sequelizeModel.rawAttributes;

    let primaryKey = 'id: Int!';
    let columns = [];
    let columnsRequiredToCreate = [];
    Object.keys(modelAttributes).forEach((attrKey) => {
        const attrName = attrKey;
        const attribute = modelAttributes[attrKey];
        const dataType = SequelizeDataTypeMapper[attribute.type.key];

        if (attribute.primaryKey) {
            primaryKey = `${attrKey}: ${dataType}!`;
        }

        const isRequired = attribute.primaryKey || !attribute.allowNull;
        const isEssential =
            !attribute.primaryKey &&
            !attribute.allowNull &&
            !attribute.defaultValue &&
            !attribute._autoGenerated;

        columns.push(`${attrKey}: ${dataType}${isRequired ? '!' : ''}`);

        if (isEssential) {
            columnsRequiredToCreate.push(`${attrKey}: ${dataType}!`);
        }
    });

    return {
        name: modelName,
        primaryKey: primaryKey,
        columns: columns,
        columnsRequiredToCreate: columnsRequiredToCreate,
    };
}

const graphqlHelper = {
    generateSchema: (sequelizeModel) => {
        const parsedModel = parseModel(sequelizeModel);

        // prettier-ignore
        const schemaFileContent = `
const ${parsedModel.name} = {
    model: \`
        type ${parsedModel.name} {
            ${parsedModel.columns.join('\n')}
        }
        type ${parsedModel.name}_page {
            count: Int!
            rows: [${parsedModel.name}]
        }
    \`,
    query: {
        read: 'read_${parsedModel.name}(${parsedModel.primaryKey}): ${parsedModel.name}',
        readItems: 'read_multiple_${parsedModel.name}(offset: Int!, limit: Int!): ${parsedModel.name}_page',
    },
    mutation: {
        create: 'create_${parsedModel.name}(${parsedModel.columnsRequiredToCreate.join(', ')}): ${parsedModel.name}',
        update: 'update_${parsedModel.name}(${parsedModel.columns.join(', ')}): ${parsedModel.name}',
    },
};

module.exports = ${parsedModel.name};
        `.trim();

        return schemaFileContent;
    },

    generateBuildSchemaFileContent: (sequelizeModels) => {
        let models = [];
        let queries = [];
        let mutations = [];

        sequelizeModels.forEach((sequelizeModel) => {
            const parsedModel = parseModel(sequelizeModel);

            // prettier-ignore
            models.push(`
type ${parsedModel.name} {
    ${parsedModel.columns.join('\n')}
}
type ${parsedModel.name}_page {
    count: Int!
    rows: [${parsedModel.name}]
}
`.trim());

            // prettier-ignore
            queries.push(`
read_${parsedModel.name}(${parsedModel.primaryKey}): ${parsedModel.name}
read_multiple_${parsedModel.name}(offset: Int!, limit: Int!): ${parsedModel.name}_page
`.trim());

            // prettier-ignore
            mutations.push(`
create_${parsedModel.name}(${parsedModel.columnsRequiredToCreate.join(', ')}): ${parsedModel.name}
update_${parsedModel.name}(${parsedModel.columns.join(', ')}): ${parsedModel.name}
`.trim());
        });

        const schemaFileContent = `
const schema = \`
    scalar Date

    ${models.join('\n')}

    type Query {
    ${queries.join('\n')}
    }

    type Mutation {
    ${mutations.join('\n')}
    }
\`;

module.exports = schema;
        `.trim();

        return schemaFileContent;
    },

    generateResolvers: (sequelizeModels) => {
        let resolvers = {
            // Custom scalar types
            Date: new GraphQLScalarType({
                name: 'Date',
                description: 'Date custom scalar type',
                parseValue(value) {
                    return new Date(value); // value from the client
                },
                serialize(value) {
                    return value.getTime(); // value sent to the client
                },
                parseLiteral(ast) {
                    if (ast.kind === Kind.INT) {
                        return new Date(ast.value); // ast value is always in string format
                    }
                    return null;
                },
            }),

            Query: {},
            Mutation: {},
        };

        sequelizeModels.forEach((sequelizeModel) => {
            const modelName = sequelizeModel.name;

            // Generate function names
            const readFuncName = `read_${modelName}`;
            const readMultipleFuncName = `read_multiple_${modelName}`;
            const createFuncName = `create_${modelName}`;
            const updateFuncName = `update_${modelName}`;

            // Create CRUD functions
            const readFunction = (_, { id }) => {
                console.log(id);
                return sequelizeModel.findByPk(id);
            };

            const readMultipleFunction = (_, { offset, limit }) => {
                console.log(offset, limit);
                return sequelizeModel.findAndCountAll({
                    where: {},
                    offset: offset,
                    limit: limit,
                });
            };

            const createFunction = (_, newItem) => {
                return sequelizeModel.create(newItem, { returning: true });
            };

            const updateFunction = (_, updatedItem) => {
                return sequelizeModel.update(updatedItem, {
                    where: {
                        id: updatedItem.id,
                    },
                });
            };

            // Assign function name for each function
            Object.defineProperty(readFunction, 'name', { writable: true });
            Object.defineProperty(readMultipleFunction, 'name', {
                writable: true,
            });
            Object.defineProperty(createFunction, 'name', { writable: true });
            Object.defineProperty(updateFunction, 'name', { writable: true });
            readFunction.name = readFuncName;
            readMultipleFunction.name = readMultipleFuncName;
            createFunction.name = createFuncName;
            updateFunction.name = updateFuncName;

            // Asssign Query and Mutation functions of the model
            resolvers = {
                ...resolvers,

                Query: {
                    ...resolvers.Query,
                    [readFuncName]: readFunction,
                    [readMultipleFuncName]: readMultipleFunction,
                },

                Mutation: {
                    ...resolvers.Mutation,
                    [createFuncName]: createFunction,
                    [updateFuncName]: updateFunction,
                },
            };
        });

        return resolvers;
    },
};

module.exports = graphqlHelper;
