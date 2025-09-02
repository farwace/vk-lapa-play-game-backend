import { Schema, type, view, ArraySchema } from "@colyseus/schema";
import { Card } from "./Card";
import {TUser} from "./types";

export class Player extends Schema {
    @type("number") id: number;
    @type("string") sessionId: string = "";

    @type("boolean") isConnected: boolean = true;
    @type("boolean") isReady: boolean = false;
    @type("boolean") canSpeak: boolean = false;
    @type("boolean") isEliminated: boolean = false;

    @view() @type([Card]) cards = new ArraySchema<Card>();
    @type([Card]) revealedCards = new ArraySchema<Card>();

    @type("number") experience: number = 0;
    @type("number") level: number = 0;
    @type("number") popularity: number = 0;
    @type("number") popularityLevel: number = 0;
    @type("boolean") isMale: boolean = true;
    @type("boolean") isVip: boolean = false;
    @type("boolean") isPremium: boolean = false;
    @type("string") avatar: string = '';


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
        this.avatar = p.avatar
    }

}
