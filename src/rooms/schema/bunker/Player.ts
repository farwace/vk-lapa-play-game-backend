import { Schema, type, ArraySchema } from "@colyseus/schema";
import { Card } from "./Card";
import {TUser} from "./types";

export class Player extends Schema {
    @type("number") id: number;
    @type("string") sessionId: string = "";

    @type("boolean") isConnected: boolean = true;
    @type("boolean") isReady: boolean = false;
    @type("boolean") canSpeak: boolean = false;
    @type("boolean") isEliminated: boolean = false;

    @type({ array: Card }) cards = new ArraySchema<Card>();
    @type(["string"]) revealedCardTypes = new ArraySchema<string>();

    @type("number") experience: number = 0;
    @type("number") level: number = 0;
    @type("number") popularity: number = 0;
    @type("number") popularityLevel: number = 0;
    @type("boolean") isMale: boolean = true;
    @type("boolean") isVip: boolean = false;
    @type("boolean") isPremium: boolean = false;


    @type("number") age: number = 0; // возраст для карточки возраста
    @type("number") votesAgainst: number = 0;

    constructor(sessionId:string, p: TUser) {
        super();
        this.sessionId = sessionId;
        this.id = p.id;
        this.isMale = p.isMale;
        this.experience = p.experience;
        this.level = p.level;
        this.popularity = p.popularity;
        this.popularityLevel = p.popularityLevel;
        this.isVip = p.isVip;
        this.isPremium = p.isPremium;
    }

}
