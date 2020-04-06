const SequelizeDataTypeMapper = {
    STRING: 'String',
    TEXT: 'String',
    CITEXT: 'String',

    BOOLEAN: 'Boolean',

    INTEGER: 'Int',
    BIGINT: 'Int',

    FLOAT: 'Float',

    REAL: 'Float',
    DOUBLE: 'Float',
    DECIMAL: 'Float',

    DATE: 'Date',
    DATEONLY: 'Date',

    UUID: 'String',
};

module.exports = SequelizeDataTypeMapper;
