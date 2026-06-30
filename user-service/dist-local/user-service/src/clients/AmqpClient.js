"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.amqpClient = void 0;
const AmqpClient_1 = require("../../shared/AmqpClient");
exports.amqpClient = new AmqpClient_1.AmqpClient('user-service');
