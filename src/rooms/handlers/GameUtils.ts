import { BunkerGameRoom } from "../BunkerGameRoom";
import { SimpleScenario } from "../schema/bunker/SimpleScenario";
import { Card, CardCustomData } from "../schema/bunker/Card";
import { RoomStatus } from "../schema/bunker/BunkerGameRoomState";
import ApiService from "../../services/ApiService";

export class GameUtils {
    static async loadScenario() {
        try {
            return await ApiService.getRandomScenario();
        } catch (error) {
            return undefined;
        }
    }

    static replacePlayersPlaces(room: BunkerGameRoom) {
        const currentCount = room.state.playersCount;
        const places = room.state.places;

        const candidates: Array<{ index: number; playerId: number }> = [];
        const freeSeats: number[] = [];

        for (const [key, playerId] of places) {
            const idx = Number(key);

            if (idx >= currentCount) {
                if (playerId > 0) candidates.push({ index: idx, playerId });
            } else {
                if (playerId === 0) freeSeats.push(idx);
            }
        }

        if (candidates.length === 0 && freeSeats.length === 0) {
            return;
        }

        candidates.sort((a, b) => a.index - b.index);
        freeSeats.sort((a, b) => a - b);

        const moveCount = Math.min(candidates.length, freeSeats.length);
        for (let i = 0; i < moveCount; i++) {
            const { playerId } = candidates[i];
            const targetSeat = freeSeats[i];
            places.set(targetSeat.toString(), playerId);
        }

        for (const [key] of places) {
            const idx = Number(key);
            if (idx >= currentCount) {
                places.set(key, 0);
            }
        }
    }

    static async initGame(room: BunkerGameRoom) {
        room.state.status = RoomStatus.PLAYING;
        const scenario = await this.loadScenario();
        room.state.scenario = new SimpleScenario(
            scenario.id,
            scenario.name,
            scenario.description,
            scenario.imageUrl,
            scenario.smallImageUrl
        );

        const usedCardIds = new Set();

        for(const [currentPlace, placedPlayerId] of room.state.places){
            if(parseInt(currentPlace) < (room.state.playersCount)){
                if(placedPlayerId > 0){
                    const player = room.state.players.get(placedPlayerId.toString());
                    if(player?.id){
                        player.cards.clear();

                        for (const type of scenario.getAllCardTypes()) {
                            if(type == 'cardsAge'){
                                const age = Math.floor(Math.random() * 110) + 1;
                                const cards = scenario[type]?.slice() || [];
                                const filtered = cards.filter(card => {
                                    return (card.customData?.from || 20) <= age && (card.customData?.to || 20) >= age;
                                });

                                if(filtered.length > 0){
                                    const customData = new CardCustomData();
                                    customData.from = filtered[0].customData.from;
                                    customData.to = filtered[0].customData.to;
                                    customData.value = age;

                                    const card = new Card(
                                        filtered[0].id,
                                        filtered[0].name,
                                        filtered[0].type,
                                        filtered[0].active,
                                        filtered[0].maleImageUrl,
                                        filtered[0].femaleImageUrl,
                                        customData,
                                        age
                                    );
                                    player.cards.push(card);
                                }
                                continue;
                            }
                            const cards = scenario[type]?.slice() || [];
                            const isMale = player.isMale;

                            const filtered = cards.filter(card => {
                                return card.active && (isMale ? !!card.maleImageUrl : !!card.femaleImageUrl);
                            });

                            const available = filtered.filter(card => !usedCardIds.has(card.id));
                            const pool = available.length > 0 ? available : filtered;
                            if (pool.length > 0) {
                                const shuffled = pool.sort(() => Math.random() - 0.5);
                                const selectedCard = shuffled[0];

                                const card = new Card(
                                    selectedCard.id,
                                    selectedCard.name,
                                    selectedCard.type,
                                    selectedCard.active,
                                    selectedCard.maleImageUrl,
                                    selectedCard.femaleImageUrl,
                                );
                                player.cards.push(card);
                                usedCardIds.add(selectedCard.id);
                            }
                        }

                        const client = room.clients.find(c => c.sessionId == player.sessionId);
                        if(client){
                            client.view.remove(player);
                            client.view.add(player);
                        }
                    }
                }
            }
        }

        room.broadcast("gameInit");
        room.state.turnTimeRemaining = 15;
        room.turnTimer = room.clock.setInterval(() => {
            room.state.turnTimeRemaining--;

            if (room.state.turnTimeRemaining <= 0) {
                room.turnTimer.clear();
                room.startGame();
            }
        }, 1000);
    }
}
