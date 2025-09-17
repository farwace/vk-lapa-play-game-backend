import axios, {AxiosResponse} from 'axios';
import {Card, CardCustomData} from '../rooms/schema/bunker/Card';
import { Scenario } from '../rooms/schema/bunker/Scenario';
import {TEcosystemResponse, TScenarioResponse, TUser} from "../rooms/schema/bunker/types";
import ConsoleService from "./ConsoleService";

export class ApiService {
    private baseUrl: string;
    constructor() {
        this.baseUrl = process.env.API_URL || 'http://localhost';
    }

    async authenticatePlayer(authString: string): Promise<TUser> {
        try{
            // Пока заглушка, которая всех аутентифицирует
            const res: AxiosResponse<TEcosystemResponse<TUser>> = await axios.post(`${this.baseUrl}/api/v1.0/bunker/user-info`, {
                    authString: authString
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.API_SECRET}`,
                        'Accept': 'application/json'
                    }
                });

            return res.data.data;
        }
        catch (error: any) {
            ConsoleService.log(error);
            return undefined;
        }
  }

  async sendStartGame(roomId: string, players: number[]): Promise<void> {
        try{
            await axios.post(
                `${this.baseUrl}/api/v1.0/game/start`,
                {
                    'room_id': roomId,
                    'players': players,
                    'code': 'bunker'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.API_SECRET}`,
                        'Accept': 'application/json'
                    }
                })
        }
        catch (error: any) {}
  }

  async sendEndGame(roomId: string, results: any[]): Promise<void> {
        try{
            await axios.post(
                `${this.baseUrl}/api/v1.0/game/complete`,
                {
                    'room_id': roomId,
                    'results': results,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.API_SECRET}`,
                        'Accept': 'application/json'
                    }
                })
        }
        catch (error: any) {}
  }


  // Получение случайного сценария с сервера
    async getRandomScenario(): Promise<Scenario> {
        try {
            const res: AxiosResponse<TEcosystemResponse<TScenarioResponse>, any> = await axios.get(`${this.baseUrl}/api/v1.0/bunker/random-script`, {
                headers: {
                    'Authorization': `Bearer ${process.env.API_SECRET}`,
                    'Accept': 'application/json'
                }
            })

            const scenario = new Scenario();
            scenario.id = res.data.data.id.toString();
            scenario.name = res.data.data.name;
            scenario.description = res.data.data.description;
            scenario.imageUrl = res.data.data.imageUrl;
            scenario.smallImageUrl = res.data.data.smallImageUrl;

            for (let i of scenario.getAllCardTypes()){
                if(res.data.data[i]){
                    res.data.data[i].forEach(cardData => {
                        const customData = new CardCustomData();
                        if(cardData.customData?.from){
                            customData.from = cardData.customData.from;
                        }
                        if(cardData.customData?.to){
                            customData.to = cardData.customData.to;
                        }

                        const card = new Card(cardData.id.toString(), cardData.name, cardData.type, cardData.active, cardData.maleImageUrl || '', cardData.femaleImageUrl || '', customData);
                        scenario[i].push(card);
                    })
                }
            }

            return scenario;
        } catch (error) {
            ConsoleService.error("Ошибка при получении сценария:", error);
            throw error;
        }
    }
}

export default new ApiService();