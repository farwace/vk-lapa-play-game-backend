import { Client } from "@colyseus/core";
import { BaseHandler } from "./BaseHandler";
import { RoomStatus } from "../schema/bunker/BunkerGameRoomState";

export class PlayerHandler extends BaseHandler {
    onChangePlace = (client: Client, payload: string | number) => {
        const parsedPlace = typeof payload === 'number'
            ? payload
            : Number.parseInt(String(payload), 10);

        if(!Number.isFinite(parsedPlace)) {
            client.send('error', 'Неверный номер места');
            return;
        }

        const placeIndex = Math.floor(parsedPlace);
        const placeNum = placeIndex.toString();
        const placeValue = this.room.state.places.get(placeNum);
        if(this.room.state.status != RoomStatus.WAITING) {
            client.send('error', 'Нельзя менять место во время игры');
            return;
        }

        if(placeIndex >= this.room.state.maxPlayers || placeIndex < 0){
            client.send('error', 'Нельзя занять это место');
            return;
        }

        if(placeValue != 0 || placeIndex >= this.room.state.playersCount){
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

    onKickPlayer = (client: Client, playerId: string | number) => {
        if(this.room.state.status != RoomStatus.WAITING) {
            client.send('error', 'Нельзя исключать игроков во время игры');
            return;
        }

        const currentPlayer = this.room.findPlayerByClientSessionId(client.sessionId);
        if(!currentPlayer){
            client.send('error', 'Не удалось идентифицировать игрока');
            return;
        }

        const targetId = this.normalizePlayerId(playerId);
        if(!targetId){
            client.send('error', 'Игрок не найден!');
            return;
        }

        if(this.room.state.hostId != currentPlayer.id){
            client.send('error', 'Исключать игроков может только лидер комнаты!');
            return;
        }

        const player = this.room.state.players.get(targetId);
        if(!player || !player?.id){
            client.send('error', 'Игрок не найден!');
            return;
        }

        if(currentPlayer.id == player.id){
            client.send('error', 'Нельзя исключить самого себя!');
            return;
        }

        try {
            for(const [currentPlace, placedPlayerId] of this.room.state.places){
                if(placedPlayerId == player.id){
                    this.room.state.places.set(currentPlace, 0);
                }
            }

            const playerClient = this.room.clients.find(c => c.sessionId === player.sessionId);

            if (playerClient) {
                playerClient.send('kicked', 'Вас исключили из комнаты');
                playerClient.leave(1000, "Kicked by host");
            }

            this.room.state.players.delete(targetId);

            if (!player.isBot) {
                this.room.voiceHandler.disconnectPlayerFromVoice(player.id.toString());
                this.room.applyKickCooldown(player.id);
            } else {
                this.room.botManager.onBotRemoved();
            }

            this.room.updateMetadata();
            this.room.voiceHandler.broadcastVoiceStatus();

            this.room.broadcast("playerKicked", {
                player: player
            }, playerClient ? {except: playerClient} : undefined);
        }
        catch (error) {}
    }

    onSetLeaderPlayer = (client: Client, playerId: string | number) => {
        if(this.room.state.status != RoomStatus.WAITING) {
            client.send('error', 'Нельзя менять лидера во время игры');
            return;
        }

        const currentPlayer = this.room.findPlayerByClientSessionId(client.sessionId);
        if(!currentPlayer){
            client.send('error', 'Не удалось идентифицировать игрока');
            return;
        }

        const targetId = this.normalizePlayerId(playerId);
        if(!targetId){
            client.send('error', 'Игрок не найден!');
            return;
        }

        if(this.room.state.hostId != currentPlayer.id){
            client.send('error', 'Назначать лидера комнаты может только лидер комнаты!');
            return;
        }

        const player = this.room.state.players.get(targetId);
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

    private normalizePlayerId(playerId: string | number): string | undefined {
        if (typeof playerId === 'number' && Number.isFinite(playerId)) {
            const normalized = Math.floor(playerId);
            return normalized >= 0 ? normalized.toString() : undefined;
        }

        if (typeof playerId === 'string') {
            const trimmed = playerId.trim();
            if (!trimmed) {
                return undefined;
            }

            if(!/^\d+$/.test(trimmed)) {
                return undefined;
            }

            return trimmed;
        }

        return undefined;
    }
}
