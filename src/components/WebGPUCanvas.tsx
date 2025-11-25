import React, { useRef, useEffect } from 'react';
import { Renderer } from '../renderer/Renderer';

const WebGPUCanvas: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<Renderer | null>(null);
    const animationFrameId = useRef<number>(0);

    useEffect(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;

        // Make canvas fill the window
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const renderer = new Renderer(canvas);
        rendererRef.current = renderer;
        
        const initAndStart = async () => {
            const success = await renderer.init();
            if (success) {
                console.log("Renderer initialized");
            } else {
                console.error("WebGPU failed to initialize");
            }
        };
        initAndStart();

        // Handle Resize
        const handleResize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            // Renderer might need resize notification to recreate depth/swapchain
            // But we do it in render() check usually.
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animationFrameId.current);
        };
    }, []);
    
    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;
            if (rendererRef.current) {
                rendererRef.current.render();
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; cancelAnimationFrame(animationFrameId.current); };
    }, []);

   return (
        <canvas
            ref={canvasRef}
            style={{ display: 'block', width: '100vw', height: '100vh', cursor: 'pointer' }}
        />
    );
};

export default WebGPUCanvas;
