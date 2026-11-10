import { SettingKey, SettingValueMap, getSettingDefinition } from '../modules/settings/settings.registry';

export type SettingsStub = {
  /** Mutable: change a value mid-test to simulate a panel change. */
  values: Partial<SettingValueMap>;
  get: jest.Mock;
  onChange: jest.Mock;
};

/**
 * SettingsService stand-in for unit tests: returns `values[key]` when set,
 * otherwise the registry's code default.
 */
export function createSettingsStub(values: Partial<SettingValueMap> = {}): SettingsStub {
  const stub: SettingsStub = {
    values,
    get: jest.fn((key: SettingKey) =>
      key in stub.values ? stub.values[key] : getSettingDefinition(key)!.default,
    ),
    onChange: jest.fn(() => jest.fn()),
  };
  return stub;
}
