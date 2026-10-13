// Web Serial transport.
//
// The sensor end of a Micolink link is a plain UART. From a browser there are
// two ways to drive a USB serial adapter: WebUSB and Web Serial. WebUSB can
// only exchange USB control/bulk traffic, so for a CDC-ACM device it would
// have to re-implement host serial line handling itself. Web Serial already
// IS that driver, has proper flow-control handling, and works with the same
// adapters. This tool therefore uses Web Serial; see the README for details.

export const PORT_FILTERS = [
  { usbVendorId: 0x1209, usbProductId: 0x5740 }, // Generic CDC (e.g. Matek H743 passthrough port)
  { usbVendorId: 0x10c4, usbProductId: 0xea60 }, // CP210x
  { usbVendorId: 0x1a86, usbProductId: 0x7523 }, // CH340
  { usbVendorId: 0x0403, usbProductId: 0x6001 }, // FTDI FT232
];

export class SerialTransport {
  constructor() {
    this.port = null;
    this.onData = null;
    this.onError = null;
    this.onDisconnect = null;
    this.open = false;
    this.#writerActive = false;
    this.#writeQueue = [];
  }

  async requestPort(filters = PORT_FILTERS) {
    this.port = await navigator.serial.requestPort({ filters });
  }

  async open(baudRate) {
    if (!this.port) throw new Error('no port selected');
    await this.port.open({
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      bufferSize: 4096,
      flowControl: 'none',
    });
    this.open = true;
    this.#readLoop();
    this.port.addEventListener('disconnect', () => {
      this.open = false;
      if (this.onDisconnect) this.onDisconnect();
    });
  }

  #writeDequeue() {
    if (this.#writerActive || !this.open || this.#writeQueue.length === 0) return;
    const data = this.#writeQueue.shift();
    this.#writerActive = true;
    (async () => {
      const writer = this.port.writable.getWriter();
      try {
        await writer.write(data);
      } catch (e) {
        if (this.onError) this.onError(e);
      } finally {
        writer.releaseLock();
        this.#writerActive = false;
        this.#writeDequeue();
      }
    })();
  }

  write(bytes) {
    if (!this.open) throw new Error('port not open');
    this.#writeQueue.push(bytes);
    this.#writeDequeue();
  }

  async #readLoop() {
    while (this.open && this.port.readable) {
      const reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (this.onData) this.onData(value);
        }
      } catch (e) {
        if (this.onError) this.onError(e);
      } finally {
        reader.releaseLock();
      }
    }
    this.open = false;
  }

  async close() {
    if (this.port) {
      this.open = false;
      try {
        await this.port.close();
      } catch (e) {
        if (this.onError) this.onError(e);
      }
    }
  }
}