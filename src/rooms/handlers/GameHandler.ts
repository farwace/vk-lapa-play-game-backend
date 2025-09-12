import { Client } from "@colyseus/core";
import { BaseHandler } from "./BaseHandler";
import { RoomStatus } from "../schema/bunker/BunkerGameRoomState";

export class GameHandler extends BaseHandler {
    onReady = (client: Client, state: boolean) => {
        if(this.room.state.status != RoomStatus.WAITING && this.room.state.status != RoomStatus.STARTING) {
            return;
        }

        const currentPlayer = this.room.findPlayerByClientSessionId(client.sessionId);
        let playerOnPlace = false;
        let allPlayersOnPlaces = true;
        for(const [currentPlace, placedPlayerId] of this.room.state.places){
            if(parseInt(currentPlace) < (this.room.state.playersCount)){
                if(placedPlayerId == currentPlayer.id){
                    playerOnPlace = true;
                }
                if(placedPlayerId == 0){
                    allPlayersOnPlaces = false;
                }
            }
        }

        if(!playerOnPlace){
            return;
        }
        if (this.room.turnTimer) {
            this.room.state.status = RoomStatus.WAITING;
            this.room.state.turnTimeRemaining = 0;
            this.room.turnTimer.clear();
        }
        currentPlayer.isReady = !!state;

        if(!allPlayersOnPlaces){
            return;
        }

        let allPlayersReady = true;
        for(const [currentPlace, placedPlayerId] of this.room.state.places){
            if(parseInt(currentPlace) < (this.room.state.playersCount)) {
                let player = this.room.state.players.get(placedPlayerId.toString());
                if (!player?.isReady) {
                    allPlayersReady = false;
                }
            }
        }

        if(!allPlayersReady){
            return;
        }

        this.room.state.turnTimeRemaining = 5;
        this.room.state.status = RoomStatus.STARTING;
        this.room.turnTimer = this.room.clock.setInterval(() => {
            this.room.state.turnTimeRemaining--;

            if (this.room.state.turnTimeRemaining <= 0) {
                this.room.turnTimer.clear();
                this.room.gameInit();
            }
        }, 1000);
    }
}
