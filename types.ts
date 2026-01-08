export interface Flashcard {
  id: string;
  question: string;
  answer: string;
  explanation?: string;
  cliExample?: string;
  category: CCNA_Category;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  domainId: number;
  deckId: string;
  deckName: string;
  isPremium: boolean;
}

export interface User {
  email: string;
  isPro: boolean;
  isGuest: boolean;
}

export type Deck = {
  deck_id: string;
  domain_int: string;
  deck_name: string;
  deck_order: string;
  is_premium: string;
};

export type Card = {
  card_id: string;
  deck_id: string;
  deck_name: string;
  front: string;
  back: string;
  explanation: string;
  difficulty?: string;
  cli_config?: string;
  cli_verify?: string;
  is_premium?: string;
  domain_int?: string;
};

export enum CCNA_Category {
  NetworkFundamentals = 'Network Fundamentals',
  NetworkAccess = 'Network Access',
  IPConnectivity = 'IP Connectivity',
  IPServices = 'IP Services',
  SecurityFundamentals = 'Security Fundamentals',
  AutomationProgrammability = 'Automation & Programmability'
}

export interface DomainInfo {
  id: number;
  title: string;
  subtitle: string;
  description: string;
  icon: string;
}

export const CCNA_DOMAINS: DomainInfo[] = [
  { id: 1, title: 'Domain 1', subtitle: 'Network Fundamentals', description: 'Routers, switches, cabling, TCP/UDP, IPv4/IPv6.', icon: '🌐' },
  { id: 2, title: 'Domain 2', subtitle: 'Network Access', description: 'VLANs, STP, EtherChannel, Wireless architecture.', icon: '🔌' },
  { id: 3, title: 'Domain 3', subtitle: 'IP Connectivity', description: 'Routing tables, OSPFv2, Static routing.', icon: '🛣️' },
  { id: 4, title: 'Domain 4', subtitle: 'IP Services', description: 'NAT, NTP, DHCP, DNS, SNMP, QoS.', icon: '🛠️' },
  { id: 5, title: 'Domain 5', subtitle: 'Security Fundamentals', description: 'Threats, VPNs, ACLs, Port Security, WPA3.', icon: '🛡️' },
  { id: 6, title: 'Domain 6', subtitle: 'Automation', description: 'REST APIs, Puppet, Chef, SDN, JSON.', icon: '🤖' }
];