const express = require('express');
const puppeteer = require('puppeteer');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'Registraduría API',
        timestamp: new Date().toISOString() 
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Endpoint principal
app.post('/api/verificar-cedula', async (req, res) => {
    const { cedula, dia, mes, ano, apiKey } = req.body;

    // Validación de API Key
    const API_KEY_VALIDA = process.env.API_KEY || 'CAMBIAR_ESTA_CLAVE_12345';
    if (apiKey !== API_KEY_VALIDA) {
        return res.status(401).json({ error: 'API Key inválida' });
    }

    // Validar parámetros
    if (!cedula || !dia || !mes || !ano) {
        return res.status(400).json({ 
            error: 'Faltan parámetros requeridos',
            required: ['cedula', 'dia', 'mes', 'ano', 'apiKey']
        });
    }

    let browser;
    try {
        console.log(`[${new Date().toISOString()}] Verificando: ${cedula} - ${dia}/${mes}/${ano}`);

        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-extensions'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('Cargando página...');
        await page.goto('https://certvigenciacedula.registraduria.gov.co/Datos.aspx', {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Buscar CAPTCHA LANAP
        console.log('Buscando CAPTCHA LANAP...');
        let captchaEncontrado = false;
        for (let i = 0; i < 30 && !captchaEncontrado; i++) {
            const captchaSrc = await page.$eval(
                '#datos_contentplaceholder1_captcha1_CaptchaImage',
                img => img.src
            );

            if (captchaSrc.includes('LanapCaptcha.aspx')) {
                captchaEncontrado = true;
                console.log(`CAPTCHA LANAP encontrado en intento ${i + 1}`);
            } else if (i < 29) {
                await page.click('a[onclick*="LBD_ReloadImage"]');
                await page.waitForTimeout(500);
            }
        }

        if (!captchaEncontrado) {
            await browser.close();
            return res.status(500).json({ 
                exito: false,
                error: 'No se pudo encontrar CAPTCHA LANAP después de 30 intentos'
            });
        }

        // Llenar formulario
        console.log('Llenando formulario...');
        await page.type('#ContentPlaceHolder1_TextBox1', cedula, { delay: 50 });
        await page.select('#ContentPlaceHolder1_DropDownList1', dia.padStart(2, '0'));
        await page.select('#ContentPlaceHolder1_DropDownList2', mes.padStart(2, '0'));
        await page.select('#ContentPlaceHolder1_DropDownList3', ano);
        await page.type('#ContentPlaceHolder1_TextBox2', 'LANAP', { delay: 50 });

        // Enviar formulario
        console.log('Enviando formulario...');
        await Promise.all([
            page.click('#ContentPlaceHolder1_Button1'),
            page.waitForNavigation({ timeout: 10000, waitUntil: 'networkidle0' })
        ]);

        const urlFinal = page.url();
        console.log(`URL final: ${urlFinal}`);

        // Verificar resultado
        if (urlFinal.includes('Respuesta.aspx')) {
            console.log('✓ ÉXITO - Cédula válida');
            
            let nombre = null;
            try {
                nombre = await page.$eval('#ContentPlaceHolder1_Label2', el => el.textContent.trim());
            } catch (e) {
                // Ignorar si no se puede extraer
            }

            await browser.close();

            return res.json({
                exito: true,
                cedula,
                fecha: `${dia}/${mes}/${ano}`,
                url: urlFinal,
                nombre,
                timestamp: new Date().toISOString()
            });

        } else if (urlFinal.includes('Datos.aspx')) {
            console.log('✗ Datos incorrectos');
            await browser.close();
            
            return res.json({
                exito: false,
                error: 'Fecha de expedición incorrecta',
                cedula,
                fecha: `${dia}/${mes}/${ano}`
            });
        }

        await browser.close();
        return res.status(500).json({ 
            exito: false,
            error: 'Respuesta inesperada del servidor' 
        });

    } catch (error) {
        console.error('Error:', error);
        if (browser) await browser.close();
        
        return res.status(500).json({ 
            exito: false,
            error: 'Error al procesar solicitud',
            detalle: error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 API corriendo en puerto ${PORT}`);
    console.log(`🔑 API Key configurada: ${process.env.API_KEY ? 'SÍ' : 'NO (usando default)'}`);
});
