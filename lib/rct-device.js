'use strict';

const { Device } = require('homey');
const Connection = require('./rctjavalib/connection');

class RCTDevice extends Device {

  async onInit() {
    this.conn = null;
    this.deleted = false;

    const currentAddress = this.getStoreValue('address');
    const currentPort = this.getStoreValue('port');
    const settingsToSync = {};
    if (currentAddress && this.getSetting('DeviceIP') !== currentAddress) {
      settingsToSync.DeviceIP = String(currentAddress);
    }
    if (currentPort && Number(this.getSetting('DevicePort')) !== Number(currentPort)) {
      settingsToSync.DevicePort = Number(currentPort);
    }
    if (Object.keys(settingsToSync).length > 0) {
      await this.setSettings(settingsToSync).catch((err) => this.error('Failed to sync connection settings:', err));
    }

    this.setAvailable();
    await this.ensureConnection();
    this.startPolling();
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Device settings changed:', changedKeys);
    let reconnectNeeded = false;

    if (changedKeys.includes('DeviceIP') && newSettings.DeviceIP) {
      const newIp = String(newSettings.DeviceIP).trim();
      await this.setStoreValue('address', newIp);
      reconnectNeeded = true;
    }

    if (changedKeys.includes('DevicePort') && newSettings.DevicePort) {
      const newPort = Number(newSettings.DevicePort);
      await this.setStoreValue('port', newPort);
      reconnectNeeded = true;
    }

    if (reconnectNeeded) {
      this._lastConnectAttempt = 0;
      if (this.conn) {
        try {
          this.conn.close();
        } catch (e) {}
        this.conn = null;
      }
      this.setAvailable();
    }

    if (reconnectNeeded || changedKeys.includes('polling_interval')) {
      const intervalSeconds = changedKeys.includes('polling_interval')
        ? newSettings.polling_interval
        : this.getSetting('polling_interval');
      // Defer startPolling slightly so Homey finishes saving settings first
      setTimeout(() => {
        if (!this.deleted) {
          this.startPolling(intervalSeconds);
        }
      }, 500);
    }
  }

  /**
  * onDeleted is called when the user deleted the device.
  */
  async onDeleted() {
    this.log('MyDevice has been deleted');
    this.deleted = true;
    this.stopPolling();
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
  }

  async ensureConnection({ throwOnError = false } = {}) {
    if (!this.conn) {
      const now = Date.now();
      if (this._lastConnectAttempt && now - this._lastConnectAttempt < 10000) {
        this.log('Delaying reconnect after recent failure');
        if (throwOnError) throw new Error('Delaying reconnect after recent failure');
        return false;
      }
      this.conn = Connection.getPooledConnection(this.getStoreValue('address'), this.getStoreValue('port'), 5000);
      try {
        await this.conn.connect();
      } catch (error) {
        this._lastConnectAttempt = now;
        this.log('Error connecting to device:', error);
        this.conn = null;
        this.setUnavailable(`Could not connect to device at ${this.getStoreValue('address')}:${this.getStoreValue('port')}`);
        if (throwOnError) throw new Error(`Could not connect to device at ${this.getStoreValue('address')}:${this.getStoreValue('port')}`);
        return false;
      }
    }
    return true;
  }

  startPolling(customIntervalSeconds) {
    const interval = (customIntervalSeconds || this.getSetting('polling_interval') || 60) * 1000;
    this.stopPolling();

    const runUpdate = async () => {
      if (this.deleted || this._isUpdating) return;
      this._isUpdating = true;
      try {
        await this.updateDeviceData();
      } catch (err) {
        this.error('Device update failed:', err);
      } finally {
        this._isUpdating = false;
      }
    };

    // Call update immediately on start
    runUpdate();

    // Then set up recurring updates
    this.pollingInterval = setInterval(runUpdate, interval);
  }

  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  // To be overridden by subclasses
  async updateDeviceData() {
    this.log('updateDeviceData() not implemented in subclass');
  }

}

module.exports = RCTDevice;
