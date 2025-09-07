import { Schema, type, ArraySchema } from "@colyseus/schema";
import { Card } from "./Card";

export class Scenario extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("string") description: string = "";
  @type("string") imageUrl: string = "";
  @type("string") smallImageUrl: string = "";

  @type([Card]) cardsProfession = new ArraySchema<Card>();
  @type([Card]) cardsAge = new ArraySchema<Card>();
  @type([Card]) cardsHealth = new ArraySchema<Card>();
  @type([Card]) cardsCharacteristic = new ArraySchema<Card>();
  @type([Card]) cardsAdditionalInformation = new ArraySchema<Card>();
  @type([Card]) cardsPhobias = new ArraySchema<Card>();
  @type([Card]) cardsSkills = new ArraySchema<Card>();
  @type([Card]) cardsLuggage = new ArraySchema<Card>();

  getAllCardTypes(): (
      "cardsProfession" |
      "cardsAge" |
      "cardsHealth" |
      "cardsCharacteristic" |
      "cardsAdditionalInformation" |
      "cardsPhobias" |
      "cardsSkills" |
      "cardsLuggage"
      )[]
  {
    return [
      "cardsProfession",
      "cardsAge",
      "cardsHealth",
      "cardsCharacteristic",
      "cardsAdditionalInformation",
      "cardsPhobias",
      "cardsSkills",
      "cardsLuggage"
    ];
  }
}
