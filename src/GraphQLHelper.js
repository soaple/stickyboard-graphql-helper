const { GraphQLScalarType, GraphQLInputObjectType } = require('graphql');
const { GraphQLString, GraphQLInt } = require('graphql/type');
const { Kind } = require('graphql/language');

const SequelizeDataTypeMapper = require('./SequelizeDataTypeMapper');

function parseModel(sequelizeModel) {
    const modelName = sequelizeModel.name;
    const modelAttributes = sequelizeModel.rawAttributes;

    let primaryKey = 'id: Int!';
    let fields = [];
    let fieldsRequiredToCreate = [];
    let columns = [];
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
            // !attribute.allowNull &&
            // !attribute.defaultValue &&
            !attribute._autoGenerated;

        fields.push(`${attrKey}: ${dataType}${isRequired ? '!' : ''}`);

        if (isEssential) {
            fieldsRequiredToCreate.push(`${attrKey}: ${dataType}!`);
        }

        columns.push(
            JSON.stringify({
                name: attrKey,
                type: dataType,
                required: isEssential,
                updatable: !attribute.primaryKey,
            })
        );
    });

    return {
        name: modelName,
        primaryKey: primaryKey,
        fields: fields,
        fieldsRequiredToCreate: fieldsRequiredToCreate,
        columns: columns,
    };
}

const graphqlHelper = {
    generateSchema: function(sequelizeModel) {
        const parsedModel = parseModel(sequelizeModel);

        // prettier-ignore
        const schemaFileContent = `
const ${parsedModel.name} = {
    columns: [
        ${parsedModel.columns.join(',\n')}
    ],
    model: \`
        type ${parsedModel.name} {
            ${parsedModel.fields.join('\n')}
        }
        type ${parsedModel.name}_page {
            count: Int!
            rows: [${parsedModel.name}]
        }
    \`,
    query: {
        read: 'read_${parsedModel.name}(${parsedModel.primaryKey}): ${parsedModel.name}',
        readItems: 'read_multiple_${parsedModel.name}(offset: Int!, limit: Int!, filter_options: [FilterOption], order_column: String, order_method: String): ${parsedModel.name}_page',
    },
    mutation: {
        create: 'create_${parsedModel.name}(${parsedModel.fieldsRequiredToCreate.join(', ')}): ${parsedModel.name}',
        update: 'update_${parsedModel.name}(${parsedModel.fields.join(', ')}): ${parsedModel.name}',
    },
};

module.exports = ${parsedModel.name};
        `.trim();

        return schemaFileContent;
    },

    generateBuildSchemaFileContent: function(sequelizeModels) {
        let models = [];
        let queries = [];
        let mutations = [];

        sequelizeModels.forEach((sequelizeModel) => {
            const parsedModel = parseModel(sequelizeModel);

            // prettier-ignore
            models.push(`
type ${parsedModel.name} {
    ${parsedModel.fields.join('\n')}
}
type ${parsedModel.name}_page {
    count: Int!
    rows: [${parsedModel.name}]
}
`.trim());

            // prettier-ignore
            queries.push(`
read_${parsedModel.name}(${parsedModel.primaryKey}): ${parsedModel.name}
read_multiple_${parsedModel.name}(offset: Int!, limit: Int!, filter_options: [FilterOption], order_column: String, order_method: String): ${parsedModel.name}_page
`.trim());

            // prettier-ignore
            mutations.push(`
create_${parsedModel.name}(${parsedModel.fieldsRequiredToCreate.join(', ')}): ${parsedModel.name}
update_${parsedModel.name}(${parsedModel.fields.join(', ')}): ${parsedModel.name}
`.trim());
        });

        const schemaFileContent = `
const schema = \`
    scalar Date

    input FilterOption {
        filterDataType: String
        filterColumnName: String
        filterColumnValue: String
    }

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

    syncSchema: function(
        fs,
        path,
        graphqlBasePath,
        sequelizeModels,
        options = {}
    ) {
        const schemaPath = path.resolve(graphqlBasePath, 'schemas');

        // Generate schema files from Sequelize model
        sequelizeModels.forEach((sequelizeModel) => {
            const schemaFileName = `${sequelizeModel.name}.js`;

            graphqlBasePath.split('/').reduce((parentDir, childDir) => {
                const curDir = path.resolve(parentDir, childDir);
                if (!fs.existsSync(curDir)) {
                    fs.mkdirSync(curDir);
                }
                return curDir;
            });

            // Create a schema path if it doesn't exist
            if (!fs.existsSync(schemaPath)) {
                fs.mkdirSync(schemaPath);
            }

            const schemaFilePath = path.resolve(schemaPath, schemaFileName);

            if (!fs.existsSync(schemaFilePath) || options.overwrite) {
                const schema = graphqlHelper.generateSchema(sequelizeModel);
                fs.writeFileSync(schemaFilePath, schema, function(err) {
                    if (err) throw err;
                    console.log(`${schemaFileName} created.`);
                });
            }
        });

        // Generate buildSchema file
        const buildSchema = graphqlHelper.generateBuildSchemaFileContent(
            sequelizeModels
        );
        const buildSchemaFileName = `schema.js`;
        const buildSchemaFilePath = path.resolve(
            schemaPath,
            buildSchemaFileName
        );
        if (!fs.existsSync(buildSchemaFilePath) || options.overwrite) {
            fs.writeFileSync(buildSchemaFilePath, buildSchema, function(err) {
                if (err) throw err;
                console.log(`${buildSchemaFileName} created.`);
            });
        }

        return buildSchemaFilePath;
    },

    generateResolvers: function(sequelizeModels) {
        let queryDict = {};
        let mutationDict = {};

        sequelizeModels.forEach((sequelizeModel) => {
            const modelName = sequelizeModel.name;

            // Generate function names
            const readFuncName = `read_${modelName}`;
            const readMultipleFuncName = `read_multiple_${modelName}`;
            const createFuncName = `create_${modelName}`;
            const updateFuncName = `update_${modelName}`;

            // Create CRUD functions
            const readFunction = (_, { id }) => {
                return sequelizeModel.findByPk(id);
            };

            const readMultipleFunction = (
                _,
                { offset, limit, filter_options, order_column, order_method }
            ) => {
                // Generate where conditions from filter options
                let whereCondition = {};
                if (filter_options) {
                    filter_options.forEach((filterOption) => {
                        let {
                            filterDataType,
                            filterColumnName,
                            filterColumnValue,
                        } = filterOption;

                        if (filterDataType === 'Int') {
                            whereCondition[filterColumnName] = new Number(
                                filterColumnValue
                            );
                        } else {
                            whereCondition[
                                filterColumnName
                            ] = filterColumnValue;
                        }
                    });
                }

                // Generate order options from order option
                let orderConditions = [];
                if (order_column && order_method) {
                    orderConditions.push([order_column, order_method]);
                }

                return sequelizeModel.findAndCountAll({
                    where: whereCondition,
                    order: orderConditions,
                    offset: offset,
                    limit: limit,
                });
            };

            const createFunction = (_, newItem) => {
                return sequelizeModel.create(newItem, { returning: true });
            };

            const updateFunction = (_, updatedItem) => {
                return sequelizeModel
                    .update(updatedItem, {
                        where: {
                            id: updatedItem.id,
                        },
                    })
                    .then(() => {
                        return sequelizeModel.findByPk(updatedItem.id);
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
            queryDict = {
                ...queryDict,
                [readFuncName]: readFunction,
                [readMultipleFuncName]: readMultipleFunction,
            };

            mutationDict = {
                ...mutationDict,
                [createFuncName]: createFunction,
                [updateFuncName]: updateFunction,
            };
        });

        const resolvers = {
            // Custom scalar types
            Date: new GraphQLScalarType({
                name: 'Date',
                description: 'Date custom scalar type',
                parseValue(value) {
                    return value.getTime(); // value from the client
                },
                serialize(value) {
                    return new Date(value); // value sent to the client
                },
                parseLiteral(ast) {
                    if (ast.kind === Kind.INT) {
                        return new Date(ast.value); // ast value is always in string format
                    }
                    return null;
                },
            }),

            // FilterOption type
            // FilterOption: new GraphQLInputObjectType({
            //     name: 'FilterOption',
            //     fields: {
            //         filterDataType: { type: GraphQLString },
            //         filterColumnName: { type: GraphQLString },
            //         filterColumnValue: { type: GraphQLString },
            //     },
            // }),

            Query: queryDict,
            Mutation: mutationDict,
        };

        return resolvers;
    },
};

module.exports = graphqlHelper;
