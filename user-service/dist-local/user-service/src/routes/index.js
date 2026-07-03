"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.internalRoutes = exports.patronRoutes = exports.userRoutes = exports.authRoutes = void 0;
var auth_routes_1 = require("./auth.routes");
Object.defineProperty(exports, "authRoutes", { enumerable: true, get: function () { return __importDefault(auth_routes_1).default; } });
var user_routes_1 = require("./user.routes");
Object.defineProperty(exports, "userRoutes", { enumerable: true, get: function () { return __importDefault(user_routes_1).default; } });
var patron_routes_1 = require("./patron.routes");
Object.defineProperty(exports, "patronRoutes", { enumerable: true, get: function () { return __importDefault(patron_routes_1).default; } });
var internal_routes_1 = require("./internal.routes");
Object.defineProperty(exports, "internalRoutes", { enumerable: true, get: function () { return __importDefault(internal_routes_1).default; } });
