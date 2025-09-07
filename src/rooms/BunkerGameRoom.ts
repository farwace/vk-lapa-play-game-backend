import {Room, Client} from "@colyseus/core";
import {StateView} from "@colyseus/schema";
import {BunkerGameRoomState, RoomStatus} from "./schema/bunker/BunkerGameRoomState";
import {Delayed, updateLobby} from "colyseus";
import ApiService from "../services/ApiService";
import {Player} from "./schema/bunker/Player";


export class BunkerGameRoom extends Room<BunkerGameRoomState> {
    maxClients = 12;
    state = new BunkerGameRoomState();

    private turnTimer: Delayed | null = null;

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
        this.state.playersCount = 8;

        for (let i = 0; i < this.state.playersCount; i++) {
            this.state.places.set(i.toString(), 0);
        }

        this.updateMetadata();
        this.onMessage('changePlace', this.onChangePlaceMessage.bind(this));
        this.onMessage('kickPlayer', this.onKickPlayerMessage.bind(this));
        this.onMessage('setLeaderPlayer', this.onSetLeaderPlayerMessage.bind(this));
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

        for(const [, playerId] of this.state.places){
            if(!playerId){
                availablePlaces += 1;
            }
        }

        const canJoin = !this.state.isPrivateRoom && availablePlaces > 0 && (this.state.status === RoomStatus.WAITING || this.state.status === RoomStatus.FINISHED);

        this.setMetadata({
            availablePlaces: availablePlaces,
            status: this.state.status,
            isPrivate: this.state.isPrivateRoom,
            canJoin: canJoin
        }).then(() => updateLobby(this));
    }

    private startTurnTimer(callback?:(args:any)=>void, args?: any) {
        this.turnTimer?.clear();
        this.turnTimer = null;

        this.state.turnTimeRemaining = this.state.turnTimeLimit;
        this.turnTimer = this.clock.setInterval(() => {
            this.state.turnTimeRemaining--;
            if (this.state.turnTimeRemaining <= 0) {
                this.turnTimer?.clear();
                this.turnTimer = null;
                callback?.(args);
            }
        }, 1000);
    }

    async onJoin(client: Client, options: any) {
        const userData = await ApiService.authenticatePlayer(options.authString || '');
        if (!userData) throw new Error('Не удалось идентифицировать игрока');

        let isReconnected = false;

        let player = this.state.players.get(userData.id.toString());
        if (!player) {
            player = new Player(client.sessionId, userData);
        } else {
            isReconnected = true;
            player.sessionId = client.sessionId; // обновим сессию при реконнекте
        }

        let placed = false;
        // если игра не началась — пытаемся занять место
        if (this.state.status === RoomStatus.WAITING) {
            for (const [index, pid] of this.state.places) {
                if (!pid) {
                    this.state.places.set(index, player.id);
                    placed = true;
                    break;
                }
            }
        }

        if(!placed){
            client.send('youAreSpectator');
        }
        else{
            this.updateMetadata();
        }

        player.isConnected = true;

        const discIdx = this.state.disconnectedPlayers.indexOf(player.id.toString());
        if (discIdx > -1) this.state.disconnectedPlayers.splice(discIdx, 1);

        // первый игрок становится хостом
        if (this.clients.length === 0 || this.state.hostId === 0) {
            this.state.hostId = player.id;
        }


        this.state.players.set(player.id.toString(), player);
        client.view = new StateView();
        client.view.add(player);

        this.broadcast(isReconnected ? 'playerReconnected' : 'playerConnected', userData);
        //todo: отправка пользователю что он наблюдатель
    }


    private findPlayerByClientSessionId(sessionId: string): Player | undefined {
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
                this.broadcast("leaderChanged", player.id);
                return;
            }
        }
        this.state.hostId = 0;
    }

    onLeave(client: Client, consented: boolean) {

        const player = this.findPlayerByClientSessionId(client.sessionId);
        if (!player) { return; }

        if(this.state.status == RoomStatus.PLAYING) {
            player.isConnected = false;
            this.broadcast("playerDisconnected", { playerId: player.id });
            //todo: выключить микрофон и переключить на следующего
            //todo: проверка на закрытие комнаты так как все вышли

            return;
        }

        for (const [index, placePlayerId] of this.state.places) {
            if (placePlayerId === player.id) {
                this.state.places.set(index, 0);
                break;
            }
        }

        if (this.state.hostId == player.id) {
            this.assignNewHost(player.id);
        }

        this.state.players.delete(player.id.toString());
        this.state.disconnectedPlayers.push(player.id.toString());

        this.updateMetadata();
        this.broadcast("playerLeft", { playerId: player.id });


        // todo: Проверяем условия окончания игры
        // this.checkGameEndConditions();
    }

    onDispose() {
        this.turnTimer?.clear();
        this.turnTimer = null;
    }


    private onChangePlaceMessage = (client: Client, payload: string) => {
        const placeNum = (+payload).toString();
        const placeValue = this.state.places.get(placeNum);
        if(this.state.status != RoomStatus.WAITING) {
            client.send('error', 'Нельзя менять место во время игры');
            return;
        }

        if(placeValue != 0){
            client.send('error', 'Место занято');
            return;
        }

        const player = this.findPlayerByClientSessionId(client.sessionId);
        if(!player){
            client.send('error', 'Не удалось идентифицировать игрока');
            return;
        }

        for(const [currentPlace, placedPlayerId] of this.state.places){
            if(placedPlayerId == player.id){
                this.state.places.set(currentPlace, 0);
            }
        }

        this.state.places.set(placeNum, player.id);
    }

    private onKickPlayerMessage = (client: Client, playerId: string) => {
        if(this.state.status != RoomStatus.WAITING) {
            client.send('error', 'Нельзя исключать игроков во время игры');
            return;
        }

        const currentPlayer = this.findPlayerByClientSessionId(client.sessionId);
        if(this.state.hostId != currentPlayer.id){
            client.send('error', 'Исключать игроков может только лидер комнаты!');
            return;
        }

        const player = this.state.players.get(playerId);
        if(!player || !player?.id){
            client.send('error', 'Игрок не найден!');
            return;
        }

        if(currentPlayer.id == player.id){
            client.send('error', 'Нельзя исключить самого себя!');
            return;
        }

        const playerClient = this.clients.find(c => c.sessionId === player.sessionId);
        if (!playerClient) {
            return;
        }

        try {
            for(const [currentPlace, placedPlayerId] of this.state.places){
                if(placedPlayerId == player.id){
                    this.state.places.set(currentPlace, 0);
                }
            }

            playerClient.send('kicked', 'Вас исключили из комнаты')
            playerClient.leave(1000, "Kicked by host");
            this.state.players.delete(playerId);

            this.broadcast("playerKicked", {
                player: player
            }, {except: playerClient});
        }
        catch (error) {}

    }
    private onSetLeaderPlayerMessage = (client: Client, playerId: string) => {
        if(this.state.status != RoomStatus.WAITING) {
            client.send('error', 'Нельзя менять лидера во время игры');
            return;
        }

        const currentPlayer = this.findPlayerByClientSessionId(client.sessionId);
        if(this.state.hostId != currentPlayer.id){
            client.send('error', 'Назначать лидера комнаты может только лидер комнаты!');
            return;
        }

        const player = this.state.players.get(playerId);
        if(!player || !player?.id){
            client.send('error', 'Игрок не найден!');
            return;
        }

        if(currentPlayer.id == player.id){
            client.send('error', 'Нельзя назначить лидером самого себя!');
            return;
        }

        const playerClient = this.clients.find(c => c.sessionId === player.sessionId);
        if (!playerClient) {
            return;
        }

        try {
            this.state.hostId = player.id;
            this.broadcast("leaderChanged", player.id);
        }
        catch (error) {}

    }

}
