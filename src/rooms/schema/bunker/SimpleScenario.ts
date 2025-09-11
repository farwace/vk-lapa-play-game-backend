import { Schema, type } from "@colyseus/schema";

export class SimpleScenario extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("string") description: string = "";
  @type("string") imageUrl: string = "";
  @type("string") smallImageUrl: string = "";

  constructor(id?: string, name?: string, description?: string, imageUrl?: string, smallImageUrl?: string) {
      super();
      if(id){
          this.id = id;
      }
      if(name){
          this.name = name;
      }
      if(description){
          this.description = description;
      }
      if(imageUrl){
          this.imageUrl = imageUrl;
      }
      if(smallImageUrl){
          this.smallImageUrl = smallImageUrl;
      }
  }
}
