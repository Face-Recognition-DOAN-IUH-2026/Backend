declare module 'ioredis' {
  import { EventEmitter } from 'events';
  export interface RedisOptions {
    host?: string;
    port?: number;
    password?: string;
    db?: number;
    url?: string;
    [key: string]: any;
  }
  export default class Redis extends EventEmitter {
    constructor(url?: string, options?: RedisOptions);
    publish(channel: string, message: string): Promise<number>;
    quit(): Promise<void>;
  }
}