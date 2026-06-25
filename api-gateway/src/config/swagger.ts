import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'api-gateway API',
      version: '1.0.0',
      description: 'API documentation for API Gateway — proxy routing, Jira integration',
    },
    servers: [{ url: '/', description: 'Local' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/index.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
