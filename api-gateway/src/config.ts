import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '80', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  services: {
    faceRecognitionApi: process.env.FACE_RECOGNITION_API || 'http://face-recognition-api:8000',
    userService: process.env.USER_SERVICE || 'http://user-service:3001',
  },
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['*'],
};