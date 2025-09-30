import { Client } from "@colyseus/core";
import { BaseHandler } from "./BaseHandler";
import { RoomStatus } from "../schema/bunker/BunkerGameRoomState";

export class RoomHandler extends BaseHandler {
    onTogglePrivate = (client: Client) => {
        if(this.room.state.status != RoomStatus.WAITING) {
            client.send('error', 'Нельзя менять приватность комнаты во время игры');
            return;
        }
        const currentPlayer = this.room.findPlayerByClientSessionId(client.sessionId);
        if(this.room.state.hostId != currentPlayer.id){
            client.send('error', 'Менять приватность может только лидер комнаты!');
            return;
        }
        this.room.state.isPrivateRoom = !this.room.state.isPrivateRoom;
        this.room.updateMetadata();
        this.room.botManager.onPrivateStatusChanged(this.room.state.isPrivateRoom);
    }
    onToggleBots = (client: Client) => {
        if(this.room.state.status != RoomStatus.WAITING) {
            client.send('error', 'Нельзя менять этот параметр во время игры');
            return;
        }
        const currentPlayer = this.room.findPlayerByClientSessionId(client.sessionId);
        if(this.room.state.hostId != currentPlayer.id){
            client.send('error', 'Менять этот параметр может только лидер комнаты!');
            return;
        }
        this.room.state.useBots = !this.room.state.useBots;
        this.room.botManager.onUseBotsStatusChanged(this.room.state.useBots);
        this.room.updateMetadata();
    }

    onChangePlayersCount = (client: Client, direction: string) => {
        if(direction != 'add' && direction != 'sub'){
            return;
        }

        if(this.room.state.status != RoomStatus.WAITING) {
            client.send('error', 'Нельзя менять количество игроков во время игры');
            return;
        }
        const currentPlayer = this.room.findPlayerByClientSessionId(client.sessionId);
        if(this.room.state.hostId != currentPlayer.id){
            client.send('error', 'Менять количество игроков может только лидер комнаты!');
            return;
        }

        const playersCount = this.room.state.playersCount;
        if(playersCount == this.room.state.minPlayers && direction == 'sub'){
            const plText = this.room.state.minPlayers == 4 ? ' игрока' : ' игроков'
            client.send('error', 'Минимум ' + this.room.state.minPlayers + plText);
            return;
        }
        if(playersCount == this.room.state.maxPlayers && direction == 'add'){
            client.send('error', 'Максимум ' + this.room.state.maxPlayers + ' игроков');
            return;
        }

        let placesCount = 0;
        for(const [currentPlace, placedPlayerId] of this.room.state.places){
            if(placedPlayerId > 0){
                placesCount ++;
            }
        }

        if(placesCount == playersCount && direction == 'sub'){
            client.send('error', 'Места заняты. Исключите игрока чтобы уменьшить количество мест');
            return;
        }

        for(const [playerId, player] of this.room.state.players.entries()) {
            if (!player.isBot) {
                player.isReady = false;
            }
        }

        if(direction == 'add'){
            this.room.state.playersCount += 1;
        }
        else{
            this.room.state.playersCount -= 1;
        }
        this.room.updateMetadata();
        this.room.replacePlayersPlaces();
    }
}
