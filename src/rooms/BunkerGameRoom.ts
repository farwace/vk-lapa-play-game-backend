import {Client, Room} from "@colyseus/core";
import {StateView} from "@colyseus/schema";
import {BunkerGameRoomState, RoomStatus} from "./schema/bunker/BunkerGameRoomState";
import {Delayed, updateLobby} from "colyseus";
import ApiService from "../services/ApiService";
import {Player} from "./schema/bunker/Player";
import {SimpleScenario} from "./schema/bunker/SimpleScenario";


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
        if(options?.isPrivate){
            this.state.isPrivateRoom = true;
        }
        let cntPlayers = 8;

        if(options?.playersCount){
            if(parseInt(options?.playersCount) >= this.state.minPlayers && parseInt(options?.playersCount) <= this.state.maxPlayers){
                cntPlayers = parseInt(options?.playersCount);
            }
        }

        this.allCardTypes.forEach(type => this.state.activeCardTypes.push(type));
        this.state.playersCount = cntPlayers;

        for (let i = 0; i < this.state.playersCount; i++) {
            this.state.places.set(i.toString(), 0);
        }

        this.updateMetadata();
        this.onMessage('changePlace', this.onChangePlaceMessage.bind(this));
        this.onMessage('kickPlayer', this.onKickPlayerMessage.bind(this));
        this.onMessage('setLeaderPlayer', this.onSetLeaderPlayerMessage.bind(this));
        this.onMessage('togglePrivateRoom', this.onTogglePrivateMessage.bind(this));
        this.onMessage('changePlayersCount', this.changePlayersCountMessage.bind(this));
        this.onMessage('ready', this.onReadyMessage.bind(this));
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

        for(const [index, playerId] of this.state.places){
            if(!playerId && (+index < this.state.playersCount)){
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


    private replacePlayersPlaces = () => {
        const currentCount = this.state.playersCount;        // допустимые места: 0..currentCount-1
        const places = this.state.places;                    // MapSchema<number>

        const candidates: Array<{ index: number; playerId: number }> = [];
        const freeSeats: number[] = [];

        // 1) Собираем кандидатов (сидят на местах >= currentCount) и свободные места внутри диапазона
        for (const [key, playerId] of places) {
            const idx = Number(key);

            if (idx >= currentCount) {
                if (playerId > 0) candidates.push({ index: idx, playerId });
            } else {
                if (playerId === 0) freeSeats.push(idx);
            }
        }

        if (candidates.length === 0 && freeSeats.length === 0) {
            return; // ничего делать не нужно
        }

        // Приоритет: пересаживаем с меньших "вне-диапазонных" индексов в меньшие свободные места
        candidates.sort((a, b) => a.index - b.index);  // напр.: 6 перед 7
        freeSeats.sort((a, b) => a - b);               // напр.: 1 перед 4

        // 2) Пересаживаем сколько поместится
        const moveCount = Math.min(candidates.length, freeSeats.length);
        for (let i = 0; i < moveCount; i++) {
            const { playerId } = candidates[i];
            const targetSeat = freeSeats[i];
            places.set(targetSeat.toString(), playerId);
        }

        // 3) Обнуляем все места вне диапазона (>= currentCount)
        for (const [key] of places) {
            const idx = Number(key);
            if (idx >= currentCount) {
                places.set(key, 0);
            }
        }

    };

    private startGame = () => {

    }

    private gameInit = async () => {
        this.state.status = RoomStatus.PLAYING;
        const scenario = await this.loadScenario();
        this.state.scenario = new SimpleScenario(
            scenario.id,
            scenario.name,
            scenario.description,
            scenario.imageUrl,
            scenario.smallImageUrl
        );

        const usedCardIds = new Set();

        for (const [_, player] of this.state.players) {
            player.cards.clear();
            player.age = 0;

            for (const type of scenario.getAllCardTypes()) {
                if(type == 'cardsAge'){
                    const age = Math.floor(Math.random() * 110) + 1;
                    const cards = scenario[type]?.slice() || [];
                    const filtered = cards.filter(card => {
                        return (card.customData?.from || 20) <= age && (card.customData?.to || 20) >= age;
                    });
                    player.age = age;
                    if(filtered.length > 0){
                        player.cards.push(filtered[0]);
                    }
                    continue;
                }
                const cards = scenario[type]?.slice() || [];
                const isMale = player.isMale;

                // Фильтрация по полу (ищем подходящие изображения)
                const filtered = cards.filter(card => {
                    return isMale ? !!card.maleImageUrl : !!card.femaleImageUrl;
                });

                // Убираем уже использованные карты
                const available = filtered.filter(card => !usedCardIds.has(card.id));

                // Если карт недостаточно — fallback на всё, что подходит
                const pool = available.length > 0 ? available : filtered;

                if (pool.length > 0) {
                    const shuffled = pool.sort(() => Math.random() - 0.5);
                    const selectedCard = shuffled[0];
                    player.cards.push(selectedCard);
                    usedCardIds.add(selectedCard.id);
                }
            }
        }

        this.broadcast("gameInit");
        this.state.turnTimeRemaining = 15;
        this.turnTimer = this.clock.setInterval(() => {
            this.state.turnTimeRemaining--;

            if (this.state.turnTimeRemaining <= 0) {
                this.turnTimer.clear();
                this.startGame();
            }
        }, 1000);
    }

    private onReadyMessage = (client: Client, state: boolean) => {
        if(this.state.status != RoomStatus.WAITING && this.state.status != RoomStatus.STARTING) {
            return;
        }

        const currentPlayer = this.findPlayerByClientSessionId(client.sessionId);
        let playerOnPlace = false;
        let allPlayersOnPlaces = true;
        for(const [currentPlace, placedPlayerId] of this.state.places){
            if(parseInt(currentPlace) < (this.state.playersCount)){
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
        if (this.turnTimer) {
            this.state.status = RoomStatus.WAITING;
            this.state.turnTimeRemaining = 0;
            this.turnTimer.clear();
        }
        currentPlayer.isReady = !!state;
        console.log('>>> ALL PLAYERS ON PLACE', allPlayersOnPlaces);
        if(!allPlayersOnPlaces){
            return;
        }

        let allPlayersReady = true;
        for(const [currentPlace, placedPlayerId] of this.state.places){
            if(parseInt(currentPlace) < (this.state.playersCount)) {
                let player = this.state.players.get(placedPlayerId.toString());
                if (!player?.isReady) {
                    allPlayersReady = false;
                }
            }
        }
        console.log('>>> ALL PLAYERS IS READY', allPlayersReady);
        if(!allPlayersReady){
            return;
        }

        this.state.turnTimeRemaining = 5;
        this.state.status = RoomStatus.STARTING;
        this.turnTimer = this.clock.setInterval(() => {
            this.state.turnTimeRemaining--;

            if (this.state.turnTimeRemaining <= 0) {
                this.turnTimer.clear();
                this.gameInit();
            }
        }, 1000);
    }

    private changePlayersCountMessage = (client: Client, direction: string) => {
        if(direction != 'add' && direction != 'sub'){
            return;
        }

        if(this.state.status != RoomStatus.WAITING) {
            client.send('error', 'Нельзя менять количество игроков во время игры');
            return;
        }
        const currentPlayer = this.findPlayerByClientSessionId(client.sessionId);
        if(this.state.hostId != currentPlayer.id){
            client.send('error', 'Менять количество игроков может только лидер комнаты!');
            return;
        }

        const playersCount = this.state.playersCount;
        if(playersCount == this.state.minPlayers && direction == 'sub'){
            client.send('error', 'Минимум ' + this.state.minPlayers + ' игроков');
            return;
        }
        if(playersCount == this.state.maxPlayers && direction == 'add'){
            client.send('error', 'Максимум ' + this.state.maxPlayers + ' игроков');
            return;
        }

        let placesCount = 0;
        for(const [currentPlace, placedPlayerId] of this.state.places){
            if(placedPlayerId > 0){
                placesCount ++;
            }
        }

        if(placesCount == playersCount && direction == 'sub'){
            client.send('error', 'Места заняты. Исключите игрока чтобы уменьшить количество мест');
            return;
        }

        for(const [playerId, player] of this.state.players.entries()) {
            player.isReady = false;
        }

        if(direction == 'add'){
            this.state.playersCount += 1;
        }
        else{
            this.state.playersCount -= 1;
        }
        this.updateMetadata();
        this.replacePlayersPlaces();
    }

    private onTogglePrivateMessage = (client: Client) => {
        if(this.state.status != RoomStatus.WAITING) {
            client.send('error', 'Нельзя менять приватность комнаты во время игры');
            return;
        }
        const currentPlayer = this.findPlayerByClientSessionId(client.sessionId);
        if(this.state.hostId != currentPlayer.id){
            client.send('error', 'Менять приватность может только лидер комнаты!');
            return;
        }
        this.state.isPrivateRoom = !this.state.isPrivateRoom;
        this.updateMetadata();
    }

    private onChangePlaceMessage = (client: Client, payload: string) => {
        const placeNum = (+payload).toString();
        const placeValue = this.state.places.get(placeNum);
        if(this.state.status != RoomStatus.WAITING) {
            client.send('error', 'Нельзя менять место во время игры');
            return;
        }

        if((+placeNum) >= this.state.maxPlayers || (+placeNum) < 0){
            client.send('error', 'Нельзя занять это место');
            return;
        }

        if(placeValue != 0 || (+placeNum) >= this.state.playersCount){
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
