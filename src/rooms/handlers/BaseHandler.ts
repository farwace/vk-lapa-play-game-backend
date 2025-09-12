import { Client } from "@colyseus/core";
import { BunkerGameRoom } from "../BunkerGameRoom";

export abstract class BaseHandler {
    protected room: BunkerGameRoom;

    constructor(room: BunkerGameRoom) {
        this.room = room;
    }
}
