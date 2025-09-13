import { Schema, type } from "@colyseus/schema";

export class CardCustomData extends Schema {
  @type("number") from?: number;
  @type("number") to?: number;
  @type("number") value?: number;
}

export class Card extends Schema {
  @type("string") id: string;
  @type("string") name: string;
  @type("string") type: string;
  @type("boolean") active: boolean;
  @type("string") maleImageUrl: string = "";
  @type("string") femaleImageUrl: string = "";
  @type(CardCustomData) customData = new CardCustomData();
  @type("boolean") isRevealed: boolean = false;
  @type("number") value: number = 0;

  constructor(id: string, name: string, type: string, active:boolean = true, maleImageUrl: string = "", femaleImageUrl: string = "", customData: CardCustomData = new CardCustomData(), value: number = 0) {
    super();
    this.id = id;
    this.name = name;
    this.type = type;
    this.active = active;
    this.maleImageUrl = maleImageUrl;
    this.femaleImageUrl = femaleImageUrl;
    this.customData = customData;
    this.value = value || 0;
  }

}
