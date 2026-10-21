import { describe, expect, it } from 'vitest';
import {
  HOME_ASSISTANT_SCOPE,
  homeAssistantBaseUrl,
  homeAssistantMcpUrl,
  homeAssistantToolAllowed,
  homeAssistantToolKind,
  homeAssistantToolLabel,
} from './home-assistant';
import { describeProposal } from './assistant-api';

describe('homeAssistantBaseUrl', () => {
  it('cleans what people paste', () => {
    expect(homeAssistantBaseUrl('home.example.com')).toBe('https://home.example.com');
    expect(homeAssistantBaseUrl(' http://192.168.1.20:8123/ ')).toBe('http://192.168.1.20:8123');
    expect(homeAssistantBaseUrl('https://abc.ui.nabu.casa/api/mcp')).toBe('https://abc.ui.nabu.casa');
    expect(homeAssistantMcpUrl('https://abc.ui.nabu.casa')).toBe('https://abc.ui.nabu.casa/api/mcp');
  });

  it('refuses what is not an http address', () => {
    expect(homeAssistantBaseUrl('')).toBeNull();
    expect(homeAssistantBaseUrl('ftp://home')).toBeNull();
    expect(homeAssistantBaseUrl('https://me:pw@home.example.com')).toBeNull();
  });
});

describe('Home Assistant tools', () => {
  it('reads Get tools and annotated ones as lookups, everything else as changes', () => {
    expect(homeAssistantToolKind('GetLiveContext')).toBe('read');
    expect(homeAssistantToolKind('HassTurnOn')).toBe('write');
    expect(homeAssistantToolKind('HassTurnOn', { readOnlyHint: true })).toBe('read');
  });

  it('labels and allows tools', () => {
    expect(homeAssistantToolLabel('HassTurnOn')).toBe('Turn on');
    expect(homeAssistantToolLabel('ha_HassLightSet')).toBe('Light set');
    expect(homeAssistantToolAllowed('HassTurnOn', null)).toBe(true);
    expect(homeAssistantToolAllowed('HassTurnOn', ['GetLiveContext'])).toBe(false);
  });

  it('describes a proposed Home Assistant change in one line', () => {
    expect(describeProposal('ha_HassTurnOff', HOME_ASSISTANT_SCOPE, { name: 'Kitchen light' })).toBe('Turn off "Kitchen light" in Home Assistant');
    expect(describeProposal('ha_HassTurnOn', HOME_ASSISTANT_SCOPE, { area: 'Living room' })).toBe('Turn on "Living room" in Home Assistant');
  });
});
