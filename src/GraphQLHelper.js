const GraphQLHelper = {
    generateSchemas: (models) => {
        models.forEach((model) => {
            const modelAttributes = model.rawAttributes;
            Object.keys(modelAttributes).forEach((attrKey) => {
                const attribute = modelAttributes[attrKey];
                console.log(attrKey, attribute.type.key);
            });
        });
    },

    generateResolvers: (models) => {
        models.forEach((model) => {
            
        });
    },
};

module.exports = GraphQLHelper;
