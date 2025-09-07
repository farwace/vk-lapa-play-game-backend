import axios, {AxiosResponse} from 'axios';
import {Card, CardCustomData} from '../rooms/schema/bunker/Card';
import { Scenario } from '../rooms/schema/bunker/Scenario';
import {TEcosystemResponse, TScenarioResponse, TUser} from "../rooms/schema/bunker/types";

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
            console.log(error);
            return undefined;
        }
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
            scenario.imageUrl = res.data.data.smallImageUrl;

            for (let i of scenario.getAllCardTypes()){
                if(res.data.data[i]){
                    res.data.data[i].forEach(cardData => {
                        const customData = new CardCustomData();
                        if(cardData.custom_data?.from){
                            customData.from = cardData.custom_data.from;
                        }
                        if(cardData.custom_data?.to){
                            customData.to = cardData.custom_data.to;
                        }

                        const card = new Card(cardData.id.toString(), cardData.name, cardData.type, cardData.active, cardData.male_image_url || '', cardData.female_image_url || '', customData);
                        scenario[i].push(card);
                    })
                }
            }

            return scenario;
        } catch (error) {
            console.error("Ошибка при получении сценария:", error);
            throw error;
        }
    }
}

export default new ApiService();