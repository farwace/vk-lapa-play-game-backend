import { Client } from "@colyseus/core";
import { BaseHandler } from "./BaseHandler";
import { RoomStatus } from "../schema/bunker/BunkerGameRoomState";

export class PlayerHandler extends BaseHandler {
    onChangePlace = (client: Client, payload: string) => {
        const placeNum = (+payload).toString();
        const placeValue = this.room.state.places.get(placeNum);
        if(this.room.state.status != RoomStatus.WAITING) {
            client.send('error', 'Нельзя менять место во время игры');
            return;
        }

        if((+placeNum) >= this.room.state.maxPlayers || (+placeNum) < 0){
            client.send('error', 'Нельзя занять это место');
            return;
        }

        if(placeValue != 0 || (+placeNum) >= this.room.state.playersCount){
            client.send('error', 'Место занято');
            return;
        }

        const player = this.room.findPlayerByClientSessionId(client.sessionId);
        if(!player){
            client.send('error', 'Не удалось идентифицировать игрока');
            return;
        }

        for(const [currentPlace, placedPlayerId] of this.room.state.places){
            if(placedPlayerId == player.id){
                this.room.state.places.set(currentPlace, 0);
            }
        }

        this.room.state.places.set(placeNum, player.id);
    }

    onKickPlayer = (client: Client, playerId: string) => {
        if(this.room.state.status != RoomStatus.WAITING) {
            client.send('error', 'Нельзя исключать игроков во время игры');
            return;
        }

        const currentPlayer = this.room.findPlayerByClientSessionId(client.sessionId);
        if(this.room.state.hostId != currentPlayer.id){
            client.send('error', 'Исключать игроков может только лидер комнаты!');
            return;
        }

        const player = this.room.state.players.get(playerId);
        if(!player || !player?.id){
            client.send('error', 'Игрок не найден!');
            return;
        }

        if(currentPlayer.id == player.id){
            client.send('error', 'Нельзя исключить самого себя!');
            return;
        }

        const playerClient = this.room.clients.find(c => c.sessionId === player.sessionId);
        if (!playerClient) {
            return;
        }

        try {
            for(const [currentPlace, placedPlayerId] of this.room.state.places){
                if(placedPlayerId == player.id){
                    this.room.state.places.set(currentPlace, 0);
                }
            }

            playerClient.send('kicked', 'Вас исключили из комнаты')
            playerClient.leave(1000, "Kicked by host");
            this.room.state.players.delete(playerId);

            this.room.broadcast("playerKicked", {
                player: player
            }, {except: playerClient});
        }
        catch (error) {}
    }

    onSetLeaderPlayer = (client: Client, playerId: string) => {
        if(this.room.state.status != RoomStatus.WAITING) {
            client.send('error', 'Нельзя менять лидера во время игры');
            return;
        }

        const currentPlayer = this.room.findPlayerByClientSessionId(client.sessionId);
        if(this.room.state.hostId != currentPlayer.id){
            client.send('error', 'Назначать лидера комнаты может только лидер комнаты!');
            return;
        }

        const player = this.room.state.players.get(playerId);
        if(!player || !player?.id){
            client.send('error', 'Игрок не найден!');
            return;
        }

        if(currentPlayer.id == player.id){
            client.send('error', 'Нельзя назначить лидером самого себя!');
            return;
        }

        const playerClient = this.room.clients.find(c => c.sessionId === player.sessionId);
        if (!playerClient) {
            return;
        }

        try {
            this.room.state.hostId = player.id;
            this.room.broadcast("leaderChanged", player.id);
        }
        catch (error) {}
    }
}
