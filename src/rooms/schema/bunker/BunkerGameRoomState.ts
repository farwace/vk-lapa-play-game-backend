import {ArraySchema, Schema, type, MapSchema} from "@colyseus/schema";
import {Player} from "./Player";
import {SimpleScenario} from "./SimpleScenario";

export enum RoomStatus {
    WAITING = "waiting",
    STARTING = "starting",
    PLAYING = "playing",
    FINISHED = "finished",
}

export enum GameStage {
    INTRODUCTION = "introduction",
    CARD_REVEAL = "card_reveal",
    VOTING = "voting",
    RESULTS = "results"
}

export class BunkerGameRoomState extends Schema {
    @type("string") status: RoomStatus = RoomStatus.WAITING;
    @type("string") gameStage: GameStage = GameStage.INTRODUCTION;

    @type("boolean") isPrivateRoom: boolean = false;
    @type("number") hostId: number = 0;

    @type("string") currentSpeakerId: string = "";
    @type("string") voiceRoomId: string = ""; // ID голосовой комнаты в LiveKit
    @type("string") customId: string = "";

    @type("boolean") useBots: boolean = true;
    @type("number") minPlayers: number = 4;
    @type("number") maxPlayers: number = 8;
    @type("number") playersCount: number = 8;
    @type({map: "number"}) places: MapSchema<number> = new MapSchema<number>();

    @type({map: Player}) players = new MapSchema<Player>();
    @type(["string"]) eliminatedPlayers = new ArraySchema<string>();
    @type(["string"]) disconnectedPlayers = new ArraySchema<string>();
    @type(SimpleScenario) scenario = new SimpleScenario();

    @type("number") currentRound: number = 0;
    @type("number") maxAbstainRounds: number = 2; // количество раундов, когда можно воздержаться
    @type("boolean") canAbstainThisRound: boolean = true; // можно ли воздержаться в текущем раунде

    @type("number") turnTimeLimit: number = 30; // сколько секунд длится ход игрока
    @type("number") turnTimeRemaining: number = 0; // сколько секунд осталось до конца хода
    @type("number") cardRevealTimeRemaining: number = 0; // сколько секунд осталось для выбора карты

    @type(["string"]) votingResults = new ArraySchema<string>();
    @type({map: "string"}) currentVotes = new MapSchema<string>(); // голоса игроков в текущем раунде

    @type(["string"]) activeCardTypes = new ArraySchema<string>();
}
