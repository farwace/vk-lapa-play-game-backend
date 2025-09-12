import { Client } from "@colyseus/core";
import { BaseHandler } from "./BaseHandler";
import { RoomStatus, GameStage } from "../schema/bunker/BunkerGameRoomState";

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

    onRevealCard = (client: Client, cardId: string) => {
        if (this.room.state.gameStage !== GameStage.CARD_REVEAL) {
            client.send('error', 'Сейчас не время для показа карт');
            return;
        }

        const player = this.room.findPlayerByClientSessionId(client.sessionId);
        if (!player) {
            client.send('error', 'Игрок не найден');
            return;
        }

        if(this.room.state.currentSpeakerId != player.id.toString()){
            client.send('error', 'Не твоя очередь для показа карт');
            return;
        }

        if(this.room.state.cardRevealTimeRemaining < 1){
            client.send('error', 'Только одну карту за раунд!');
        }

        if (!this.room.gameEngine.revealCard(player.id.toString(), cardId)) {
            client.send('error', 'Не удалось показать карту');
        }
    }

    onFinishSpeaking = (client: Client) => {
        if (this.room.state.gameStage !== GameStage.CARD_REVEAL) {
            client.send('error', 'Сейчас не время для завершения речи');
            return;
        }

        const player = this.room.findPlayerByClientSessionId(client.sessionId);
        if (!player) {
            client.send('error', 'Игрок не найден');
            return;
        }

        if (!this.room.gameEngine.finishSpeaking(player.id.toString())) {
            client.send('error', 'Не удалось завершить речь');
        }
    }

    onVote = (client: Client, targetId: string) => {
        if (this.room.state.gameStage !== GameStage.VOTING) {
            client.send('error', 'Сейчас не время для голосования');
            return;
        }

        const player = this.room.findPlayerByClientSessionId(client.sessionId);
        if (!player) {
            client.send('error', 'Игрок не найден');
            return;
        }

        // Проверяем, что можно воздержаться, если targetId === "0"
        if (targetId === "0" && !this.room.state.canAbstainThisRound) {
            client.send('error', 'В этом раунде нельзя воздержаться от голосования');
            return;
        }

        if (!this.room.gameEngine.vote(player.id.toString(), targetId)) {
            client.send('error', 'Не удалось проголосовать');
        }
    }

}
