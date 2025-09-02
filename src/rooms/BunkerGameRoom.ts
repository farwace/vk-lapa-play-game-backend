import {Room, Client} from "@colyseus/core";
import {BunkerGameRoomState, RoomStatus} from "./schema/bunker/BunkerGameRoomState";
import {Delayed, updateLobby} from "colyseus";
import ApiService from "../services/ApiService";
import {Player} from "./schema/bunker/Player";


export class BunkerGameRoom extends Room<BunkerGameRoomState> {
    maxClients = 12;
    state = new BunkerGameRoomState();

    private turnTimer?: Delayed;

    private allCardTypes = [
        "cardsProfession",
        "cardsAge",
        "cardsHealth",
        "cardsCharacteristic",
        "cardsAdditionalInformation",
        "cardsPhobias",
        "cardsSkills",
        "cardsLuggage"
    ];

    async onCreate(options: any) {
        this.allCardTypes.forEach(type => this.state.activeCardTypes.push(type));
        this.state.minPlayers = 6;
        this.state.maxPlayers = 8;

        for (let i = 0; i < this.state.maxPlayers; i++) {
            this.state.places.set(i.toString(), 0);
        }

        // this.onMessage("kickPlayer", this.onKickPlayer.bind(this));
        // this.setSimulationInterval(() => this.update());


    }

    private loadScenario = async () => {
        try {
            return await ApiService.getRandomScenario();
        } catch (error) {
            return undefined;
        }
    }

    private updateMetadata = () => {
        let availablePlaces = 0;

        for(const [index, playerId] of this.state.places.entries()){
            if(!playerId){
                availablePlaces += 1;
            }
        }

        this.setMetadata({
            availablePlaces: availablePlaces,
            status: this.state.status,
            isPrivate: this.state.isPrivateRoom,
            canJoin: !this.state.isPrivateRoom && availablePlaces > 0 && [RoomStatus.WAITING, RoomStatus.FINISHED].indexOf(this.state.status) > -1,
        }).then(() => updateLobby(this));
    }

    private startTurnTimer(callback?:(args:any)=>void, args?: any) {
        if (this.turnTimer) {
            this.turnTimer.clear();
        }
        this.state.turnTimeRemaining = this.state.turnTimeLimit;
        this.turnTimer = this.clock.setInterval(() => {
            this.state.turnTimeRemaining--;
            if (this.state.turnTimeRemaining <= 0) {
                this.turnTimer.clear();
                callback(args);
            }
        }, 1000);
    }

    async onJoin(client: Client, options: any, auth: any) {
        try {

            const userData= await ApiService.authenticatePlayer(options.authString || '');
            if(!userData){
                throw new Error('Не удалось идентифицировать игрока');
            }

            let existingPlayer = this.state.players.get(userData.id.toString());
            if(!existingPlayer){
                existingPlayer = new Player(client.sessionId, userData);
                this.broadcast("playerConnected", userData);
            }
            else{
                this.broadcast("playerReconnected", userData);
            }


            // Проверка, если игра не началась - игрок может занять место
            if (this.state.status == RoomStatus.WAITING) {
                let hasPlace = false;
                for(const [index, playerId] of this.state.places.entries()){
                    if(!playerId && !hasPlace){
                        this.state.places.set(index, existingPlayer.id);
                        hasPlace = true;
                        this.updateMetadata();
                    }
                }
            }

            existingPlayer.isConnected = true;

            if (this.state.disconnectedPlayers.indexOf(existingPlayer.id.toString()) > -1) {
                delete this.state.disconnectedPlayers[this.state.disconnectedPlayers.indexOf(existingPlayer.id.toString())];
            }

            // Если это первый игрок, делаем его хостом
            if (this.clients.length === 1) {
                this.state.hostId = existingPlayer.id;
            }

            // Добавляем игрока в состояние
            this.state.players.set(existingPlayer.id.toString(), existingPlayer);

            this.broadcast('playerJoined', existingPlayer);

        } catch (error) {
            /** @ts-ignore */
            console.error(`Ошибка при входе игрока: ${error.message}`);
            throw error;
        }
    }


    private findPlayerIdByClientSessionId(sessionId: string): Player | undefined {
        for(const [playerId, player] of this.state.players.entries()) {
            if(player.sessionId == sessionId){
                return player;
            }
        }
        return undefined;
    }

    private assignNewHost(ignorePlayerId: number) {
        for(const [playerId, player] of this.state.players.entries()) {
            if(player.id != ignorePlayerId){
                this.state.hostId = player.id;
                return;
            }
        }
        this.state.hostId = undefined;
    }

    onLeave(client: Client, consented: boolean) {

        const player = this.findPlayerIdByClientSessionId(client.sessionId);
        if (!player) {
            console.log(`Клиент ${client.sessionId} вышел, но не был связан с игроком`);
            return;
        }
        if(this.state.status == RoomStatus.PLAYING) {
            player.isConnected = false;
            this.broadcast("playerDisconnected", { playerId: player.id });
            //todo: выключить микрофон и переключить на следующего
        }
        else{
            if (this.state.hostId == player.id) {
                this.assignNewHost(player.id);
            }

            for (const [index, placePlayerId] of this.state.places.entries()) {
                if (placePlayerId === player.id) {
                    this.state.places.set(index, 0);
                    break;
                }
            }
            this.updateMetadata();

            this.state.players.delete(player.id.toString());
            this.state.disconnectedPlayers.push(player.id.toString());
            this.broadcast("playerLeft", { playerId: player.id });
        }

        // todo: Проверяем условия окончания игры
        // this.checkGameEndConditions();
    }

    onDispose() {
        if (this.turnTimer) {
            this.turnTimer.clear();
        }
    }

}
